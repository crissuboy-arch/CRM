/**
 * POST /api/v1/integrations/athena/commands/[id]/decision — a decisão
 * HUMANA sobre um comando que a Athena pediu.
 *
 * Só sessão, só admin da organização, com a guarda de escrita de suporte.
 * Um token de serviço NUNCA decide: esta rota nem sequer está em
 * `PUBLIC_PATHS`, por isso o proxy exige sessão antes de o handler correr,
 * e o `requireRole` confirma o papel. É este o gate que separa "a Athena
 * pede" de "um humano autorizou".
 *
 * Aprovar NÃO executa o comando nesta fase — regista a decisão
 * (`approved`), auditada. O executor é uma fase futura, autorizada à
 * parte. Contrato: `docs/integracao/athena.md`.
 */
import { randomUUID } from "node:crypto";

import { type NextRequest } from "next/server";
import { z } from "zod";

import { audit } from "@/lib/audit";
import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { athenaIntegrationEnabled } from "@/lib/integrations/athena/config";
import { decisaoAthenaSchema } from "@/lib/integrations/athena/contrato";
import { decidirJobAthena } from "@/lib/integrations/athena/jobs";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const requestId = randomUUID();

  if (!athenaIntegrationEnabled()) {
    return fail("not_found", "Integração Athena desligada.", 404, { requestId });
  }

  const authz = await requireRole("admin", { requestId, resource: "athena_commands" });
  if (!authz.ok) return authz.response;

  const supportDenied = await requireSupportWrite(authz.org.orgId);
  if (supportDenied) return supportDenied;

  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) {
    return fail("not_found", "Job não encontrado.", 404, { requestId });
  }

  const raw = await req.json().catch(() => null);
  const parsed = decisaoAthenaSchema.safeParse(raw);
  if (!parsed.success) {
    return fail("validation_failed", "Dados inválidos.", 422, {
      requestId,
      details: parsed.error.flatten().fieldErrors as Record<string, unknown>,
    });
  }

  try {
    const desfecho = await decidirJobAthena(createAdminClient(), {
      organizationId: authz.org.orgId,
      jobId: id,
      decision: parsed.data.decision,
      decidedByUserId: authz.user.id,
      note: parsed.data.note,
    });

    if (desfecho.tipo === "not_found") {
      return fail("not_found", "Job não encontrado.", 404, { requestId });
    }
    if (desfecho.tipo === "already_decided") {
      return fail("conflict", "Este comando já foi decidido.", 409, {
        requestId,
        details: { state: desfecho.job.state },
      });
    }

    void audit({
      action:
        parsed.data.decision === "approve" ? "athena.command_approved" : "athena.command_rejected",
      actorUserId: authz.user.id,
      organizationId: authz.org.orgId,
      resourceType: "athena_command",
      resourceId: id,
      requestId,
      metadata: { decision: parsed.data.decision, state: desfecho.job.state },
    });

    return ok({ job_id: id, state: desfecho.job.state }, { requestId });
  } catch {
    return fail("internal_error", "Erro ao decidir o comando.", 500, { requestId });
  }
}
