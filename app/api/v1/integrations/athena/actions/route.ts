/**
 * POST /api/v1/integrations/athena/actions — a Athena PEDE uma ação.
 *
 * A ação NUNCA executa aqui: nasce um registo em `pending_approval` (ver
 * `lib/integrations/athena/acoes.ts`) e só uma pessoa com sessão o decide em
 * `…/actions/[id]/decision`. Nesta fase nem a aprovação executa — regista a
 * decisão; o executor é fase futura, autorizada à parte.
 *
 * Auth: Bearer `dsk_...` de `api_tokens` com o escopo `athena:actions`
 * (ou sessão, via `autenticarAthena`). A organização vem do token/sessão —
 * nunca do corpo. Desligada (`ATHENA_INTEGRATION_ENABLED` ≠ `true`), a
 * rota responde 404, como se não existisse.
 *
 * A `Idempotency-Key` é OBRIGATÓRIA neste contrato (§5): repetir o mesmo
 * pedido com a mesma chave devolve a resposta original, sem registar outra
 * ação — é o que torna o retry da Athena seguro.
 *
 * Contrato: `docs/integracao/athena.md` (§3.4).
 */
import { randomUUID } from "node:crypto";

import { type NextRequest } from "next/server";
import { z } from "zod";

import { audit } from "@/lib/audit";
import { tetoDeEscritaDoToken } from "@/lib/api/auth-dual";
import { chaveDaRequisicao, comIdempotencia } from "@/lib/api/idempotency";
import { fail, ok } from "@/lib/api/wrappers";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { criarAcaoAthena } from "@/lib/integrations/athena/acoes";
import { autenticarAthena } from "@/lib/integrations/athena/auth";
import { ATHENA_SCOPE_ACTIONS, athenaIntegrationEnabled } from "@/lib/integrations/athena/config";
import { acaoAthenaSchema } from "@/lib/integrations/athena/contrato";

export const dynamic = "force-dynamic";

/** Tag do endpoint no recibo de idempotência. Muda de rota muda de recibo. */
const ENDPOINT = "/api/v1/integrations/athena/actions";

export async function POST(req: NextRequest): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();

  if (!athenaIntegrationEnabled()) {
    return fail("not_found", "Integração Athena desligada.", 404, { requestId });
  }

  const auth = await autenticarAthena(req, {
    requestId,
    resource: "athena_actions",
    role: "agent",
    scope: ATHENA_SCOPE_ACTIONS,
  });
  if (!auth.ok) return auth.response;

  // Destruídos aqui, antes das closures: o narrowing da união perde-se
  // dentro de `executar()`; os valores capturados, não.
  const db = auth.supabase;
  const organizationId = auth.organizationId;
  const apiTokenId = auth.apiTokenId;
  const actorUserId = auth.actor.type === "user" ? auth.actor.id : undefined;

  const teto = await tetoDeEscritaDoToken(auth, "athena_actions", requestId);
  if (teto) return teto;

  // Sem chave não há recibo — e sem recibo um retry da Athena registaria a
  // ação duas vezes. Por isso a chave é obrigatória (contrato §5), ao
  // contrário da preparação v1, onde era opcional.
  const chave = chaveDaRequisicao(req);
  if (chave === null) {
    return fail("bad_request", "Idempotency-Key é obrigatória.", 400, { requestId });
  }
  if (!z.string().uuid().safeParse(chave).success) {
    return fail("bad_request", "Idempotency-Key deve ser UUID", 400, { requestId });
  }

  const raw = await req.json().catch(() => null);
  const parsed = acaoAthenaSchema.safeParse(raw);
  if (!parsed.success) {
    return fail("validation_failed", "Dados inválidos.", 422, {
      requestId,
      details: parsed.error.flatten().fieldErrors as Record<string, unknown>,
    });
  }

  const dados = parsed.data;

  /** O efeito: registar a ação pendente e auditar. Lança em falha, para o
   *  recibo de idempotência não guardar o retrato de uma ação inexistente. */
  async function executar() {
    const acao = await criarAcaoAthena(db, {
      organizationId,
      type: dados.type,
      params: dados.params,
      reason: dados.reason,
      apiTokenId,
    });
    void audit({
      action: "athena.command_received",
      actorUserId,
      actorApiTokenId: apiTokenId,
      organizationId,
      resourceType: "athena_action",
      resourceId: acao.action_id,
      requestId,
      metadata: { type: dados.type, state: "pending_approval" },
    });
    return {
      action_id: acao.action_id,
      type: dados.type,
      state: "pending_approval" as const,
      created_at: acao.created_at,
    };
  }

  try {
    const desfecho = await comIdempotencia({
      db,
      organizationId,
      endpoint: ENDPOINT,
      chave,
      corpo: dados,
      executar: async () => ({ resposta: await executar(), status: 201 }),
    });

    if (desfecho.tipo === "conflito") {
      return fail(
        "idempotency_conflict",
        "Esta chave de idempotência já foi usada com outro conteúdo.",
        409,
        { requestId },
      );
    }
    if (desfecho.tipo === "em_curso") {
      return fail(
        "idempotency_in_progress",
        "A mesma requisição ainda está em curso. Tente de novo em instantes.",
        409,
        { requestId },
      );
    }
    return ok(desfecho.resposta, { requestId, status: 201 });
  } catch {
    return fail("internal_error", "Erro ao registar a ação.", 500, { requestId });
  }
}
