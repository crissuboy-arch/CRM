/**
 * POST /api/v1/integrations/athena/actions/[id]/decision — o gate humano:
 *
 *  - sem sessão de admin (o caso de um token de serviço a tentar decidir),
 *    a decisão nem é tentada: a ação fica `pending_approval`;
 *  - o admin da organização aprova e a decisão fica auditada com o seu
 *    utilizador e papel — e a auditoria é AGUARDADA: a rota só responde
 *    depois de a evidência estar gravada, porque é ela que a rota de
 *    approval vai ler;
 *  - decidir uma ação já decidida é 409; uma de outra organização é 404
 *    (a camada de dados nem a vê);
 *  - decisão fora de approve/reject é 422.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { NextRequest } from "next/server";

const ORG = "22222222-2222-4222-8222-222222222222";
const USER = "11111111-1111-4111-8111-111111111111";
const ACTION_ID = "44444444-4444-4444-8444-444444444444";

const cfg = vi.hoisted(() => ({ enabled: true }));
const estado = vi.hoisted(() => ({ auditoriaGravada: false }));

vi.mock("@/lib/integrations/athena/config", () => ({
  ATHENA_SCOPE_ACTIONS: "athena:actions",
  athenaIntegrationEnabled: () => cfg.enabled,
}));

vi.mock("@/lib/impersonate/support", () => ({
  requireSupportWrite: vi.fn(async () => null),
}));

vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));

vi.mock("@/lib/auth/require-role", () => ({ requireRole: vi.fn() }));

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));

vi.mock("@/lib/integrations/athena/acoes", () => ({
  criarAcaoAthena: vi.fn(),
  lerAcaoAthena: vi.fn(async () => null),
  decidirAcaoAthena: vi.fn(),
  lerEvidenciaDaDecisaoAthena: vi.fn(async () => null),
}));

import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { decidirAcaoAthena } from "@/lib/integrations/athena/acoes";

import { POST } from "./route";

const adminOk = {
  ok: true,
  user: { id: USER },
  org: { orgId: ORG, role: "admin" },
};

function pedido(body: unknown): NextRequest {
  return new NextRequest(
    `http://localhost/api/v1/integrations/athena/actions/${ACTION_ID}/decision`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}

function chamar(body: unknown): Promise<Response> {
  return POST(pedido(body), { params: Promise.resolve({ id: ACTION_ID }) });
}

describe("POST /integrations/athena/actions/[id]/decision", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cfg.enabled = true;
    estado.auditoriaGravada = false;
    vi.mocked(requireRole).mockResolvedValue(adminOk as never);
    // A auditoria só "grava" num tick posterior: se a rota não a aguardasse,
    // a resposta sairia com a flag ainda a false.
    vi.mocked(audit).mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
      estado.auditoriaGravada = true;
    });
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
    expect(decidirAcaoAthena).not.toHaveBeenCalled();
  });

  it("o admin aprova → 200 approved, auditada com utilizador e papel, auditoria aguardada", async () => {
    vi.mocked(decidirAcaoAthena).mockResolvedValue({
      tipo: "decidido",
      acao: { action_id: ACTION_ID, state: "approved" },
    } as never);
    const res = await chamar({ decision: "approve", note: "ok" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { action_id: string; state: string } };
    expect(body.data).toEqual({ action_id: ACTION_ID, state: "approved" });
    expect(decidirAcaoAthena).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        organizationId: ORG,
        actionId: ACTION_ID,
        decision: "approve",
        decidedByUserId: USER,
        decidedByRole: "admin",
      }),
    );
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "athena.command_approved",
        actorUserId: USER,
        resourceType: "athena_action",
        metadata: expect.objectContaining({ decision: "approve", decided_by_role: "admin" }),
      }),
    );
    // A resposta só saiu depois de a evidência estar gravada.
    expect(estado.auditoriaGravada).toBe(true);
  });

  it("ação já decidida → 409 conflict com o estado atual", async () => {
    vi.mocked(decidirAcaoAthena).mockResolvedValue({
      tipo: "already_decided",
      acao: { action_id: ACTION_ID, state: "approved" },
    } as never);
    const res = await chamar({ decision: "reject" });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("conflict");
  });

  it("ação de outra organização (invisível à camada de dados) → 404", async () => {
    vi.mocked(decidirAcaoAthena).mockResolvedValue({ tipo: "not_found" } as never);
    const res = await chamar({ decision: "approve" });
    expect(res.status).toBe(404);
  });

  it("decisão fora de approve/reject → 422", async () => {
    const res = await chamar({ decision: "talvez" });
    expect(res.status).toBe(422);
    expect(decidirAcaoAthena).not.toHaveBeenCalled();
  });

  it("integração desligada → 404 antes de qualquer verificação de papel", async () => {
    cfg.enabled = false;
    const res = await chamar({ decision: "approve" });
    expect(res.status).toBe(404);
    expect(requireRole).not.toHaveBeenCalled();
  });
});
