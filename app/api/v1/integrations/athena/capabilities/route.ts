/**
 * GET /api/v1/integrations/athena/capabilities — o que a Athena pode PEDIR
 * nesta organização: o catálogo de ações, os estados suportados e o resumo
 * do agente da organização. É a rota que a Athena consulta antes de propor
 * qualquer ação.
 *
 * JSON PLANO, como o health e o stats. A organização vem da credencial —
 * nunca do pedido. Desligada, responde 404 plano, como se não existisse.
 * Todas as ações do catálogo são sensíveis e exigem aprovação humana, sem
 * exceções neste contrato.
 *
 * Contrato: `docs/integracao/athena.md` (§3.3).
 */
import { randomUUID } from "node:crypto";

import { type NextRequest } from "next/server";

import { autenticarAthena } from "@/lib/integrations/athena/auth";
import {
  ATHENA_SCOPE_CAPABILITIES,
  athenaIntegrationEnabled,
} from "@/lib/integrations/athena/config";
import { ACOES_ATHENA, ESTADOS_DA_ACAO_ATHENA } from "@/lib/integrations/athena/contrato";
import {
  nomeDaOrganizacao,
  resumoDoAgenteDaOrganizacao,
} from "@/lib/integrations/athena/estatisticas";
import { erroPlano, respostaPlana } from "@/lib/integrations/athena/respostas";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();

  if (!athenaIntegrationEnabled()) {
    return erroPlano("not_found", 404, requestId);
  }

  const auth = await autenticarAthena(req, {
    requestId,
    resource: "athena_capabilities",
    role: "viewer",
    scope: ATHENA_SCOPE_CAPABILITIES,
  });
  if (!auth.ok) {
    return erroPlano(
      auth.code,
      auth.status,
      requestId,
      auth.requiredScope ? { required_scope: auth.requiredScope } : undefined,
    );
  }

  try {
    return respostaPlana(
      {
        platform: "NEXORA CRM",
        contract: "v1",
        organization: {
          id: auth.organizationId,
          name: await nomeDaOrganizacao(auth.supabase, auth.organizationId),
        },
        integration: { enabled: true },
        actions: ACOES_ATHENA.map((type) => ({
          type,
          sensitive: true,
          requires_approval: true,
        })),
        action_states: [...ESTADOS_DA_ACAO_ATHENA],
        agent: await resumoDoAgenteDaOrganizacao(auth.supabase, auth.organizationId),
        timestamp: new Date().toISOString(),
      },
      requestId,
    );
  } catch {
    return erroPlano("internal_error", 500, requestId);
  }
}
