/**
 * GET /api/v1/integrations/athena/commands/[id] — o estado de um job.
 *
 * A Athena pergunta "o meu comando já foi decidido?" por aqui. A
 * organização é a do token/sessão de quem pergunta: um job de outra
 * organização responde 404, igual a um que não existe — o id não é um
 * canal para sondar o que é dos outros.
 *
 * Contrato: `docs/integracao/athena.md`.
 */
import { randomUUID } from "node:crypto";

import { type NextRequest } from "next/server";
import { z } from "zod";

import { resolveAuthDual } from "@/lib/api/auth-dual";
import { fail, ok } from "@/lib/api/wrappers";
import { ATHENA_SCOPE, athenaIntegrationEnabled } from "@/lib/integrations/athena/config";
import { lerJobAthena } from "@/lib/integrations/athena/jobs";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const requestId = randomUUID();

  if (!athenaIntegrationEnabled()) {
    return fail("not_found", "Integração Athena desligada.", 404, { requestId });
  }

  const authz = await resolveAuthDual(req, {
    requestId,
    resource: "athena_commands",
    role: "viewer",
    scope: ATHENA_SCOPE,
  });
  if (!authz.ok) return authz.response;

  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) {
    return fail("not_found", "Job não encontrado.", 404, { requestId });
  }

  try {
    const job = await lerJobAthena(authz.supabase, {
      organizationId: authz.organizationId,
      jobId: id,
    });
    if (!job) return fail("not_found", "Job não encontrado.", 404, { requestId });
    return ok(job, { requestId });
  } catch {
    return fail("internal_error", "Erro ao ler o job.", 500, { requestId });
  }
}
