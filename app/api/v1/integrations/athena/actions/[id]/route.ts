/**
 * GET /api/v1/integrations/athena/actions/[id] — o estado de uma ação.
 *
 * A Athena pergunta "a minha ação já foi decidida?" por aqui. A organização
 * é a do token/sessão de quem pergunta: uma ação de outra organização
 * responde 404, igual a uma que não existe — o id não é um canal para
 * sondar o que é dos outros.
 *
 * Os `params` NÃO voltam nesta resposta (podem conter dados de clientes) e
 * `decided_by` também não: a evidência de quem decidiu vive na rota
 * `…/approval`, que é a superfície feita para isso (contrato §3.5/§3.6).
 *
 * Contrato: `docs/integracao/athena.md` (§3.5).
 */
import { randomUUID } from "node:crypto";

import { type NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { lerAcaoAthena } from "@/lib/integrations/athena/acoes";
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
    return ok(
      {
        action_id: acao.action_id,
        type: acao.type,
        state: acao.state,
        reason: acao.reason,
        created_at: acao.created_at,
        decided_at: acao.decided_at,
      },
      { requestId },
    );
  } catch {
    return fail("internal_error", "Erro ao ler a ação.", 500, { requestId });
  }
}
