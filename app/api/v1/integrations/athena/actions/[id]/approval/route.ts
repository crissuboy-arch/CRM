/**
 * GET /api/v1/integrations/athena/actions/[id]/approval — a evidência
 * verificável da decisão humana sobre uma ação.
 *
 * É o equivalente, neste produto, ao `approvalRef` do padrão TrendHub: a
 * Athena apresenta a `approval_ref` na Athena Control como prova de que um
 * humano decidiu. A prova em si é o registo de auditoria da decisão
 * (`api_audit_log`), lido por `lerEvidenciaDaDecisaoAthena` — por isso a
 * rota da decisão só responde depois de a auditoria estar gravada.
 *
 * Ação ainda pendente não é erro: responde 200 com `approval_ref: null` e
 * `decision: null` — "ainda ninguém decidiu" é um estado, não uma falha.
 * Ação de outra organização responde 404, como nas outras rotas.
 *
 * Contrato: `docs/integracao/athena.md` (§3.6).
 */
import { randomUUID } from "node:crypto";

import { type NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import {
  lerAcaoAthena,
  lerEvidenciaDaDecisaoAthena,
} from "@/lib/integrations/athena/acoes";
import { autenticarAthena } from "@/lib/integrations/athena/auth";
import { ATHENA_SCOPE_ACTIONS, athenaIntegrationEnabled } from "@/lib/integrations/athena/config";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const requestId = randomUUID();

  if (!athenaIntegrationEnabled()) {
    return fail("not_found", "Integração Athena desligada.", 404, { requestId });
  }

  const auth = await autenticarAthena(req, {
    requestId,
    resource: "athena_actions",
    role: "viewer",
    scope: ATHENA_SCOPE_ACTIONS,
  });
  if (!auth.ok) return auth.response;

  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) {
    return fail("not_found", "Ação não encontrada.", 404, { requestId });
  }

  try {
    const acao = await lerAcaoAthena(auth.supabase, {
      organizationId: auth.organizationId,
      actionId: id,
    });
    if (!acao) return fail("not_found", "Ação não encontrada.", 404, { requestId });

    if (acao.state === "pending_approval") {
      return ok(
        {
          action_id: acao.action_id,
          state: "pending_approval",
          approval_ref: null,
          decision: null,
        },
        { requestId },
      );
    }

    const evidencia = await lerEvidenciaDaDecisaoAthena(auth.supabase, {
      organizationId: auth.organizationId,
      actionId: id,
    });

    return ok(
      {
        action_id: acao.action_id,
        state: acao.state,
        approval_ref: `nexora://actions/${id}/approval`,
        decision: acao.state === "approved" ? "approve" : "reject",
        decided_by: { user_id: acao.decided_by, role: acao.decided_by_role },
        decided_at: acao.decided_at,
        note: acao.decision_note,
        audit: evidencia ? { log_id: evidencia.log_id, action: evidencia.action } : null,
      },
      { requestId },
    );
  } catch {
    return fail("internal_error", "Erro ao ler a evidência da decisão.", 500, { requestId });
  }
}
