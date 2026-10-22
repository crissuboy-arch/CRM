/**
 * O registo das ações pedidas pela Athena mora no `event_log` — a fila
 * canónica do produto — sem tabela nova e sem migration:
 *
 * - Criar uma ação é emitir o evento `athena.command_received`
 *   (`entity_kind = "athena_action"`, `entity_id = action_id`) pela RPC
 *   `emit_event`, com o estado no `payload.state`. O tipo de evento mantém
 *   o nome `command_received`: é o vocabulário que o contrato fixa para a
 *   auditoria, mesmo depois da renomeação commands → actions nas rotas.
 * - O estado de aprovação (`pending_approval` → `approved` | `rejected`)
 *   vive no payload; o `status` do `event_log` fica `pending`, que é a
 *   verdade: nenhum handler está registado para este tipo de evento, por
 *   isso o drain ignora-o — nada executa sozinho.
 * - Ler e decidir filtram SEMPRE por `organization_id` resolvida por quem
 *   chama (token ou sessão, nunca do pedido): uma ação de outra
 *   organização é indistinguível de uma ação que não existe.
 *
 * A decisão usa compare-and-swap sobre o payload inteiro: o UPDATE só
 * acerta se o payload ainda for exatamente o que foi lido. Duas decisões
 * simultâneas não passam as duas — a segunda encontra o payload mudado,
 * atualiza zero linhas e é recusada como `already_decided`.
 *
 * A evidência da decisão NÃO mora aqui: mora em `api_audit_log` (a tabela
 * real da auditoria da casa, escrita por `lib/audit/index.ts`), e
 * `lerEvidenciaDaDecisaoAthena` é a leitura dela — é esse registo que a
 * rota de *approval* apresenta como recibo verificável da decisão humana.
 */
import { randomUUID } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { EstadoDaAcaoAthena } from "./contrato";

export const EVENTO_ACAO_ATHENA = "athena.command_received";
export const ENTIDADE_ACAO_ATHENA = "athena_action";
/** `resource_type` das linhas de `api_audit_log` que decidem uma ação. */
export const RECURSO_AUDITORIA_ATHENA = "athena_action";

export interface AcaoAthenaRegistada {
  action_id: string;
  organization_id: string;
  type: string;
  state: EstadoDaAcaoAthena;
  /** O `status` cru do event_log (o pipeline de eventos, não a aprovação). */
  event_status: string;
  reason: string | null;
  created_at: string;
  decided_by: string | null;
  decided_at: string | null;
  decision_note: string | null;
  decided_by_role: string | null;
}

interface LinhaDaAcao {
  id: string;
  organization_id: string;
  payload: Record<string, unknown>;
  status: string;
  created_at: string;
}

function comoPayload(valor: unknown): Record<string, unknown> {
  return valor !== null && typeof valor === "object" && !Array.isArray(valor)
    ? (valor as Record<string, unknown>)
    : {};
}

function comoEstado(valor: unknown): EstadoDaAcaoAthena {
  return valor === "approved" || valor === "rejected" ? valor : "pending_approval";
}

function comoTexto(valor: unknown): string | null {
  return typeof valor === "string" ? valor : null;
}

function paraAcao(linha: LinhaDaAcao, actionId: string): AcaoAthenaRegistada {
  const p = linha.payload;
  return {
    action_id: actionId,
    organization_id: linha.organization_id,
    // `type` é o nome do contrato oficial; `command` é aceite na leitura
    // por robustez — linhas gravadas pela preparação v1, se existirem,
    // continuam legíveis em vez de nascerem com o tipo vazio.
    type: comoTexto(p.type ?? p.command) ?? "",
    state: comoEstado(p.state),
    event_status: linha.status,
    reason: comoTexto(p.reason),
    created_at: linha.created_at,
    decided_by: comoTexto(p.decided_by),
    decided_at: comoTexto(p.decided_at),
    decision_note: comoTexto(p.decision_note),
    decided_by_role: comoTexto(p.decided_by_role),
  };
}

async function lerLinhaDaAcao(
  db: SupabaseClient,
  organizationId: string,
  actionId: string,
): Promise<LinhaDaAcao | null> {
  const { data, error } = await db
    .from("event_log")
    .select("id, organization_id, payload, status, created_at")
    .eq("organization_id", organizationId)
    .eq("entity_kind", ENTIDADE_ACAO_ATHENA)
    .eq("entity_id", actionId)
    .maybeSingle();
  if (error) throw new Error(`ler ação falhou: ${error.message}`);
  if (!data) return null;
  return { ...data, payload: comoPayload(data.payload) } as LinhaDaAcao;
}

/**
 * Cria a ação (pendente de aprovação) e devolve o registo completo.
 *
 * Depois de emitir o evento, LÊ a linha criada: quem chama precisa do
 * `created_at` verdadeiro do banco na resposta `201`, e inventá-lo no
 * cliente faria o recibo mentir sobre quando o pedido nasceu. Se a
 * leitura falhar, lança — um `201` sem registo legível não existe.
 */
export async function criarAcaoAthena(
  db: SupabaseClient,
  entrada: {
    organizationId: string;
    type: string;
    params: Record<string, unknown>;
    reason?: string;
    apiTokenId?: string;
  },
): Promise<AcaoAthenaRegistada> {
  const actionId = randomUUID();
  const { error } = await db.rpc("emit_event", {
    p_event_type: EVENTO_ACAO_ATHENA,
    p_entity_kind: ENTIDADE_ACAO_ATHENA,
    p_entity_id: actionId,
    p_payload: {
      type: entrada.type,
      params: entrada.params,
      reason: entrada.reason ?? null,
      state: "pending_approval" satisfies EstadoDaAcaoAthena,
    },
    p_metadata: { source: "athena-integration", api_token_id: entrada.apiTokenId ?? null },
    p_organization_id: entrada.organizationId,
  });
  if (error) throw new Error(`emit_event falhou: ${error.message}`);

  const registada = await lerAcaoAthena(db, {
    organizationId: entrada.organizationId,
    actionId,
  });
  if (!registada) throw new Error("emit_event não devolveu a ação criada");
  return registada;
}

/** Lê uma ação da organização. De outra organização (ou inexistente): `null`. */
export async function lerAcaoAthena(
  db: SupabaseClient,
  entrada: { organizationId: string; actionId: string },
): Promise<AcaoAthenaRegistada | null> {
  const linha = await lerLinhaDaAcao(db, entrada.organizationId, entrada.actionId);
  return linha ? paraAcao(linha, entrada.actionId) : null;
}

export type DesfechoDaDecisao =
  | { tipo: "decidido"; acao: AcaoAthenaRegistada }
  | { tipo: "not_found" }
  | { tipo: "already_decided"; acao: AcaoAthenaRegistada };

/**
 * A decisão humana. Só transita a partir de `pending_approval`; decidir
 * duas vezes (ou uma ação alheia) nunca executa nada nem finge sucesso.
 * O papel de quem decidiu (`decided_by_role`) fica no payload: a evidência
 * apresenta "um admin decidiu", e sem o papel gravado essa frase não se
 * pode provar a partir do registo.
 */
export async function decidirAcaoAthena(
  db: SupabaseClient,
  entrada: {
    organizationId: string;
    actionId: string;
    decision: "approve" | "reject";
    decidedByUserId: string;
    decidedByRole: string;
    note?: string;
  },
): Promise<DesfechoDaDecisao> {
  const linha = await lerLinhaDaAcao(db, entrada.organizationId, entrada.actionId);
  if (!linha) return { tipo: "not_found" };

  const atual = paraAcao(linha, entrada.actionId);
  if (atual.state !== "pending_approval") return { tipo: "already_decided", acao: atual };

  const novoEstado: EstadoDaAcaoAthena = entrada.decision === "approve" ? "approved" : "rejected";
  const novoPayload = {
    ...linha.payload,
    state: novoEstado,
    decided_by: entrada.decidedByUserId,
    decided_at: new Date().toISOString(),
    decision_note: entrada.note ?? null,
    decided_by_role: entrada.decidedByRole,
  };

  const { data, error } = await db
    .from("event_log")
    .update({ payload: novoPayload })
    .eq("id", linha.id)
    .eq("organization_id", entrada.organizationId)
    .eq("payload", linha.payload)
    .select("id");
  if (error) throw new Error(`decidir ação falhou: ${error.message}`);
  if (!data || data.length === 0) {
    // Alguém decidiu entre a leitura e a escrita — relê e reporta o estado real.
    const relida = await lerAcaoAthena(db, entrada);
    return relida ? { tipo: "already_decided", acao: relida } : { tipo: "not_found" };
  }
  return {
    tipo: "decidido",
    acao: {
      ...atual,
      state: novoEstado,
      decided_by: entrada.decidedByUserId,
      decided_at: novoPayload.decided_at,
      decision_note: novoPayload.decision_note,
      decided_by_role: novoPayload.decided_by_role,
    },
  };
}

export interface EvidenciaDaDecisaoAthena {
  log_id: string;
  action: string;
  actor_user_id: string | null;
  created_at: string;
}

/**
 * A evidência da decisão: a linha de `api_audit_log` que a gravou.
 *
 * É a linha MAIS RECENTE de aprovação/rejeição desta ação nesta
 * organização — a decisão é única por desenho (compare-and-swap), por
 * isso "a mais recente" e "a única" são a mesma linha; a ordenação só
 * protege contra ruído histórico. Sem decisão, devolve `null`: pendente
 * não tem evidência, e a rota responde com `approval_ref: null`.
 */
export async function lerEvidenciaDaDecisaoAthena(
  db: SupabaseClient,
  entrada: { organizationId: string; actionId: string },
): Promise<EvidenciaDaDecisaoAthena | null> {
  const { data, error } = await db
    .from("api_audit_log")
    .select("id, action, actor_user_id, created_at")
    .eq("organization_id", entrada.organizationId)
    .eq("resource_type", RECURSO_AUDITORIA_ATHENA)
    .eq("resource_id", entrada.actionId)
    .in("action", ["athena.command_approved", "athena.command_rejected"])
    .order("created_at", { ascending: false })
    .limit(1);
  if (error) throw new Error(`ler evidência falhou: ${error.message}`);
  const linha = (data ?? [])[0] as
    | { id: string; action: string; actor_user_id: string | null; created_at: string }
    | undefined;
  if (!linha) return null;
  return {
    log_id: linha.id,
    action: linha.action,
    actor_user_id: linha.actor_user_id ?? null,
    created_at: linha.created_at,
  };
}
