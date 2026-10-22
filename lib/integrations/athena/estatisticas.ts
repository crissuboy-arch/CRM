/**
 * Os agregados que `GET /stats` entrega à Athena: contagens REAIS da
 * organização da credencial — nunca registos individuais de clientes,
 * conversas ou leads (princípio 5 do contrato).
 *
 * O cliente que chega aqui pode ser o de service role, que salta a RLS:
 * por isso TODAS as consultas filtram `organization_id` à mão, resolvido
 * por quem chama a partir da credencial — nunca do pedido. É a doutrina
 * da casa para service role, e aqui ela é a única coisa entre uma
 * organização e as contagens da vizinha.
 *
 * Os recortes usam os valores reais do schema (verificados no baseline):
 * os estados de conversa do atendimento, `is_dry_run` das corridas do
 * agente (corrida de ensaio não é corrida) e `archived_at` dos agentes
 * (agente arquivado não está configurado — está guardado).
 */
import type { SupabaseClient } from "@supabase/supabase-js";

const DIA_MS = 24 * 60 * 60 * 1000;

/** O nome apresentável da organização: `display_name`, senão o legal, senão "". */
export async function nomeDaOrganizacao(
  db: SupabaseClient,
  organizationId: string,
): Promise<string> {
  const { data, error } = await db
    .from("organizations")
    .select("display_name, legal_name")
    .eq("id", organizationId)
    .maybeSingle();
  if (error) throw new Error(`ler organização falhou: ${error.message}`);
  const display = typeof data?.display_name === "string" ? data.display_name : "";
  if (display.trim() !== "") return display;
  const legal = typeof data?.legal_name === "string" ? data.legal_name : "";
  return legal.trim() !== "" ? legal : "";
}

export interface EstatisticasAthena {
  organization: { id: string; name: string };
  conversations: { open: number; in_progress: number; closed_30d: number };
  leads: { total: number; new_30d: number };
  contacts: { total: number };
  agents: { configured: number; active: number; runs_30d: number };
  support: { cases_open: number };
}

/** Uma contagem exata sem trazer linha nenhuma (`head: true`). Lança em falha. */
async function contar(
  consulta: PromiseLike<{ count: number | null; error: { message: string } | null }>,
): Promise<number> {
  const { count, error } = await consulta;
  if (error) throw new Error(`contagem falhou: ${error.message}`);
  return count ?? 0;
}

/**
 * As estatísticas da organização. `agora` é injetável para a janela de 30
 * dias ser testável sem relógio de parede: o corte é `agora − 30d`.
 */
export async function estatisticasDaOrganizacao(
  db: SupabaseClient,
  organizationId: string,
  agora: Date = new Date(),
): Promise<EstatisticasAthena> {
  const corte30d = new Date(agora.getTime() - 30 * DIA_MS).toISOString();

  const [
    name,
    conversasAbertas,
    conversasEmCurso,
    conversasFechadas30d,
    leadsTotal,
    leadsNovos30d,
    contactosTotal,
    agentesConfigurados,
    agentesAtivos,
    corridas30d,
    casosAbertos,
  ] = await Promise.all([
    nomeDaOrganizacao(db, organizationId),
    contar(
      db
        .from("conversations")
        .select("*", { count: "exact", head: true })
        .eq("organization_id", organizationId)
        .in("status", ["open", "pending", "claimed", "ai_handling"]),
    ),
    contar(
      db
        .from("conversations")
        .select("*", { count: "exact", head: true })
        .eq("organization_id", organizationId)
        .in("status", ["claimed", "ai_handling"]),
    ),
    contar(
      db
        .from("conversations")
        .select("*", { count: "exact", head: true })
        .eq("organization_id", organizationId)
        .in("status", ["resolved", "closed"])
        .gte("updated_at", corte30d),
    ),
    contar(
      db
        .from("crm_leads")
        .select("*", { count: "exact", head: true })
        .eq("organization_id", organizationId),
    ),
    contar(
      db
        .from("crm_leads")
        .select("*", { count: "exact", head: true })
        .eq("organization_id", organizationId)
        .gte("created_at", corte30d),
    ),
    contar(
      db
        .from("contacts")
        .select("*", { count: "exact", head: true })
        .eq("organization_id", organizationId),
    ),
    contar(
      db
        .from("ai_agents")
        .select("*", { count: "exact", head: true })
        .eq("organization_id", organizationId)
        .is("archived_at", null),
    ),
    contar(
      db
        .from("ai_agents")
        .select("*", { count: "exact", head: true })
        .eq("organization_id", organizationId)
        .eq("is_active", true)
        .is("archived_at", null),
    ),
    contar(
      db
        .from("ai_agent_runs")
        .select("*", { count: "exact", head: true })
        .eq("organization_id", organizationId)
        .gte("created_at", corte30d)
        .eq("is_dry_run", false),
    ),
    contar(
      db
        .from("agent_cases")
        .select("*", { count: "exact", head: true })
        .eq("organization_id", organizationId)
        .in("status", ["awaiting_human", "awaiting_lead"]),
    ),
  ]);

  return {
    organization: { id: organizationId, name },
    conversations: {
      open: conversasAbertas,
      in_progress: conversasEmCurso,
      closed_30d: conversasFechadas30d,
    },
    leads: { total: leadsTotal, new_30d: leadsNovos30d },
    contacts: { total: contactosTotal },
    agents: { configured: agentesConfigurados, active: agentesAtivos, runs_30d: corridas30d },
    support: { cases_open: casosAbertos },
  };
}

/**
 * O resumo do agente da organização para as *capabilities*: existe agente
 * configurado (não arquivado)? Algum está ativo? É a mesma semântica das
 * contagens de `estatisticasDaOrganizacao`, reduzida a existência — quem
 * chama não precisa dos números, precisa dos dois booleanos.
 */
export async function resumoDoAgenteDaOrganizacao(
  db: SupabaseClient,
  organizationId: string,
): Promise<{ configured: boolean; active: boolean }> {
  const [configurados, ativos] = await Promise.all([
    contar(
      db
        .from("ai_agents")
        .select("*", { count: "exact", head: true })
        .eq("organization_id", organizationId)
        .is("archived_at", null),
    ),
    contar(
      db
        .from("ai_agents")
        .select("*", { count: "exact", head: true })
        .eq("organization_id", organizationId)
        .eq("is_active", true)
        .is("archived_at", null),
    ),
  ]);
  return { configured: configurados > 0, active: ativos > 0 };
}
