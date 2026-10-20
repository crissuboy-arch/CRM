/**
 * POST /api/v1/integrations/athena/webhook — a Athena avisa de eventos
 * dela (ex.: uma missão concluída do lado de lá).
 *
 * Duas credenciais, as duas obrigatórias:
 *  1. Bearer `dsk_...` com o escopo `athena:commands` — diz QUE
 *     organização está a receber o aviso (a organização vem do token,
 *     nunca do corpo);
 *  2. HMAC-SHA256 do corpo cru com `ATHENA_WEBHOOK_SECRET`, no cabeçalho
 *     `x-athena-signature` — prova que o conteúdo não foi adulterado.
 *
 * Sem segredo configurado a rota responde 404 (fail-closed: segredo em
 * falta nunca é "aceita sem assinar"). Assinatura inválida é 401 e fica
 * auditada. O aviso vira um evento `athena.webhook_received` no
 * `event_log`; nenhum handler o consome nesta fase.
 *
 * Contrato: `docs/integracao/athena.md`.
 */
import { randomUUID } from "node:crypto";

import { type NextRequest } from "next/server";
import { z } from "zod";

import { audit } from "@/lib/audit";
import { resolveAuthDual } from "@/lib/api/auth-dual";
import { chaveDaRequisicao, comIdempotencia } from "@/lib/api/idempotency";
import { fail, ok } from "@/lib/api/wrappers";
import { requireSupportWrite } from "@/lib/impersonate/support";
import {
  ATHENA_SIGNATURE_HEADER,
  assinaturaAthenaValida,
} from "@/lib/integrations/athena/assinatura";
import {
  ATHENA_SCOPE,
  athenaIntegrationEnabled,
  athenaWebhookSecret,
} from "@/lib/integrations/athena/config";
import { webhookAthenaSchema } from "@/lib/integrations/athena/contrato";
import { registarWebhookAthena } from "@/lib/integrations/athena/jobs";

export const dynamic = "force-dynamic";

/** Tag do endpoint no recibo de idempotência. Muda de rota muda de recibo. */
const ENDPOINT = "/api/v1/integrations/athena/webhook";

export async function POST(req: NextRequest): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();

  if (!athenaIntegrationEnabled()) {
    return fail("not_found", "Integração Athena desligada.", 404, { requestId });
  }

  const secret = athenaWebhookSecret();
  if (!secret) {
    return fail("not_found", "Webhook da Athena desligado.", 404, { requestId });
  }

  const authz = await resolveAuthDual(req, {
    requestId,
    resource: "athena_webhooks",
    role: "agent",
    scope: ATHENA_SCOPE,
  });
  if (!authz.ok) return authz.response;

  // Destruídos aqui, antes das closures: o narrowing da união perde-se
  // dentro de `executar()`; os valores capturados, não.
  const db = authz.supabase;
  const organizationId = authz.organizationId;
  const apiTokenId = authz.apiTokenId;

  // O HMAC é sobre o corpo CRU — ler como texto antes de qualquer parse.
  const rawBody = await req.text();
  if (!assinaturaAthenaValida(rawBody, req.headers.get(ATHENA_SIGNATURE_HEADER), secret)) {
    void audit({
      action: "athena.webhook_invalid_signature",
      actorApiTokenId: apiTokenId,
      organizationId,
      resourceType: "athena_webhook",
      requestId,
    });
    return fail("invalid_signature", "Assinatura inválida.", 401, { requestId });
  }

  let rawJson: unknown = null;
  try {
    rawJson = JSON.parse(rawBody);
  } catch {
    rawJson = null;
  }
  const parsed = webhookAthenaSchema.safeParse(rawJson);
  if (!parsed.success) {
    return fail("validation_failed", "Dados inválidos.", 422, {
      requestId,
      details: parsed.error.flatten().fieldErrors as Record<string, unknown>,
    });
  }

  const chave = chaveDaRequisicao(req);
  if (chave !== null && !z.string().uuid().safeParse(chave).success) {
    return fail("validation_error", "Idempotency-Key deve ser UUID", 400, { requestId });
  }

  const dados = parsed.data;

  /** O efeito: registar o evento e auditar. Lança em falha (ver commands). */
  async function executar() {
    const eventId = await registarWebhookAthena(db, {
      organizationId,
      event: dados.event,
      data: dados.data,
      apiTokenId,
    });
    void audit({
      action: "athena.webhook_received",
      actorApiTokenId: apiTokenId,
      organizationId,
      resourceType: "athena_webhook",
      resourceId: eventId,
      requestId,
      metadata: { event: dados.event },
    });
    return { received: true as const, event_id: eventId };
  }

  if (chave === null) {
    try {
      return ok(await executar(), { requestId, status: 201 });
    } catch {
      return fail("internal_error", "Erro ao registar o webhook.", 500, { requestId });
    }
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
    return fail("internal_error", "Erro ao registar o webhook.", 500, { requestId });
  }
}
