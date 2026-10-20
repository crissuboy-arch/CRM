/**
 * POST /api/v1/integrations/athena/commands/[id]/decision — o gate humano:
 *
 *  - sem sessão de admin (o caso de um token de serviço a tentar decidir),
 *    a decisão nem é tentada: o job fica `pending_approval`;
 *  - o admin da organização aprova/rejeita e a decisão fica auditada com
 *    o seu utilizador;
 *  - decidir um job já decidido é 409; um job de outra organização é 404
 *    (a camada de dados nem o vê);
 *  - decisão fora de approve/reject é 422.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { NextRequest } from "next/server";

const ORG = "22222222-2222-4222-8222-222222222222";
const USER = "11111111-1111-4111-8111-111111111111";
const JOB_ID = "44444444-4444-4444-8444-444444444444";

const cfg = vi.hoisted(() => ({ enabled: true }));

vi.mock("@/lib/integrations/athena/config", () => ({
  ATHENA_SCOPE: "athena:commands",
  athenaIntegrationEnabled: () => cfg.enabled,
  athenaWebhookSecret: () => "",
}));

vi.mock("@/lib/impersonate/support", () => ({
  requireSupportWrite: vi.fn(async () => null),
}));

vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));

vi.mock("@/lib/auth/require-role", () => ({ requireRole: vi.fn() }));

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));

vi.mock("@/lib/integrations/athena/jobs", () => ({
  criarJobAthena: vi.fn(async () => JOB_ID),
  lerJobAthena: vi.fn(async () => null),
  decidirJobAthena: vi.fn(),
  registarWebhookAthena: vi.fn(async () => "evt-1"),
}));

import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { decidirJobAthena } from "@/lib/integrations/athena/jobs";

import { POST } from "./route";

const adminOk = {
  ok: true,
  user: { id: USER },
  org: { orgId: ORG, role: "admin" },
};

function pedido(body: unknown): NextRequest {
  return new NextRequest(
    `http://localhost/api/v1/integrations/athena/commands/${JOB_ID}/decision`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}

function chamar(body: unknown): Promise<Response> {
  return POST(pedido(body), { params: Promise.resolve({ id: JOB_ID }) });
}

describe("POST /integrations/athena/commands/[id]/decision", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cfg.enabled = true;
    vi.mocked(requireRole).mockResolvedValue(adminOk as never);
  });

  it("sem sessão de admin → recusado e a decisão nem é tentada", async () => {
    vi.mocked(requireRole).mockResolvedValue({
      ok: false,
      response: new Response(JSON.stringify({ error: { code: "unauthorized" } }), {
        status: 401,
      }),
    } as never);
    const res = await chamar({ decision: "approve" });
    expect(res.status).toBe(401);
    expect(decidirJobAthena).not.toHaveBeenCalled();
  });

  it("o admin aprova → 200 approved, com a organização e o autor certos", async () => {
    vi.mocked(decidirJobAthena).mockResolvedValue({
      tipo: "decidido",
      job: { job_id: JOB_ID, state: "approved" },
    } as never);
    const res = await chamar({ decision: "approve", note: "ok" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { job_id: string; state: string } };
    expect(body.data).toEqual({ job_id: JOB_ID, state: "approved" });
    expect(decidirJobAthena).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        organizationId: ORG,
        jobId: JOB_ID,
        decision: "approve",
        decidedByUserId: USER,
      }),
    );
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "athena.command_approved", actorUserId: USER }),
    );
  });

  it("job já decidido → 409 conflict com o estado atual", async () => {
    vi.mocked(decidirJobAthena).mockResolvedValue({
      tipo: "already_decided",
      job: { job_id: JOB_ID, state: "approved" },
    } as never);
    const res = await chamar({ decision: "reject" });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("conflict");
  });

  it("job de outra organização (invisível à camada de dados) → 404", async () => {
    vi.mocked(decidirJobAthena).mockResolvedValue({ tipo: "not_found" } as never);
    const res = await chamar({ decision: "approve" });
    expect(res.status).toBe(404);
  });

  it("decisão fora de approve/reject → 422", async () => {
    const res = await chamar({ decision: "talvez" });
    expect(res.status).toBe(422);
    expect(decidirJobAthena).not.toHaveBeenCalled();
  });

  it("integração desligada → 404 antes de qualquer verificação de papel", async () => {
    cfg.enabled = false;
    const res = await chamar({ decision: "approve" });
    expect(res.status).toBe(404);
    expect(requireRole).not.toHaveBeenCalled();
  });
});
