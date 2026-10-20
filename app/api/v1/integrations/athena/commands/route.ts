/**
 * POST /api/v1/integrations/athena/commands — a Athena PEDE um comando.
 *
 * O comando NUNCA executa aqui: nasce um job em `pending_approval` no
 * `event_log` (ver `lib/integrations/athena/jobs.ts`) e só uma pessoa com
 * sessão o decide em `…/commands/[id]/decision`. Nesta fase nem a
 * aprovação executa — regista a decisão; o executor é fase futura.
 *
 * Auth: Bearer `dsk_...` de `api_tokens` com o escopo `athena:commands`
 * (ou sessão, via `resolveAuthDual`). A organização vem do token/sessão —
 * nunca do corpo. Desligada (`ATHENA_INTEGRATION_ENABLED` ≠ `true`), a
 * rota responde 404, como se não existisse.
 *
 * Contrato: `docs/integracao/athena.md`.
 */
import { randomUUID } from "node:crypto";

import { type NextRequest } from "next/server";
import { z } from "zod";

import { audit } from "@/lib/audit";
import { resolveAuthDual, tetoDeEscritaDoToken } from "@/lib/api/auth-dual";
import { chaveDaRequisicao, comIdempotencia } from "@/lib/api/idempotency";
import { fail, ok } from "@/lib/api/wrappers";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { ATHENA_SCOPE, athenaIntegrationEnabled } from "@/lib/integrations/athena/config";
import { comandoAthenaSchema } from "@/lib/integrations/athena/contrato";
import { criarJobAthena } from "@/lib/integrations/athena/jobs";

export const dynamic = "force-dynamic";

/** Tag do endpoint no recibo de idempotência. Muda de rota muda de recibo. */
const ENDPOINT = "/api/v1/integrations/athena/commands";

export async function POST(req: NextRequest): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();

  if (!athenaIntegrationEnabled()) {
    return fail("not_found", "Integração Athena desligada.", 404, { requestId });
  }

  const authz = await resolveAuthDual(req, {
    requestId,
    resource: "athena_commands",
    role: "agent",
    scope: ATHENA_SCOPE,
  });
  if (!authz.ok) return authz.response;

  // Destruídos aqui, antes das closures: o narrowing da união perde-se
  // dentro de `executar()`; os valores capturados, não.
  const db = authz.supabase;
  const organizationId = authz.organizationId;
  const apiTokenId = authz.apiTokenId;
  const actorUserId = authz.actor.type === "user" ? authz.actor.id : undefined;

  const teto = await tetoDeEscritaDoToken(authz, "athena_commands", requestId);
  if (teto) return teto;

  const raw = await req.json().catch(() => null);
  const parsed = comandoAthenaSchema.safeParse(raw);
  if (!parsed.success) {
    return fail("validation_failed", "Dados inválidos.", 422, {
      requestId,
      details: parsed.error.flatten().fieldErrors as Record<string, unknown>,
    });
  }

  // Idempotency-Key, quando vem, tem de ser UUID — a mesma régua das
  // outras rotas de criação (spec 01 §7.3).
  const chave = chaveDaRequisicao(req);
  if (chave !== null && !z.string().uuid().safeParse(chave).success) {
    return fail("validation_error", "Idempotency-Key deve ser UUID", 400, { requestId });
  }

  const dados = parsed.data;

  /** O efeito: criar o job pendente e auditar. Lança em falha, para o
   *  recibo de idempotência não guardar o retrato de um job inexistente. */
  async function executar() {
    const jobId = await criarJobAthena(db, {
      organizationId,
      command: dados.command,
      params: dados.params,
      reason: dados.reason,
      apiTokenId,
    });
    void audit({
      action: "athena.command_received",
      actorUserId,
      actorApiTokenId: apiTokenId,
      organizationId,
      resourceType: "athena_command",
      resourceId: jobId,
      requestId,
      metadata: { command: dados.command, state: "pending_approval" },
    });
    return { job_id: jobId, command: dados.command, state: "pending_approval" as const };
  }

  if (chave === null) {
    try {
      return ok(await executar(), { requestId, status: 201 });
    } catch {
      return fail("internal_error", "Erro ao registar o comando.", 500, { requestId });
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
    return fail("internal_error", "Erro ao registar o comando.", 500, { requestId });
  }
}
