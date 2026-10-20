/**
 * POST /api/v1/integrations/athena/webhook — as provas da rota:
 *
 *  - assinatura inválida (ou ausente) → 401, fica auditada e NADA se regista;
 *  - assinatura válida + token da organização → 201 e o evento é registado
 *    nessa organização;
 *  - sem segredo configurado, a rota é 404 (fail-closed: segredo em falta
 *    nunca é "aceita sem assinar");
 *  - sem Bearer, nem a assinatura chega a ser avaliada para registar.
 */
import { createHmac } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { NextRequest } from "next/server";

const ORG = "22222222-2222-4222-8222-222222222222";
const EVENTO_ID = "66666666-6666-4666-8666-666666666666";
const SEGREDO_TESTE = "segredo-de-teste-com-mais-de-32-caracteres";
const OUTRO_SEGREDO = "outro-segredo-qualquer-com-32-caracteres";

const cfg = vi.hoisted(() => ({ enabled: true, segredo: "" }));

vi.mock("@/lib/integrations/athena/config", () => ({
  ATHENA_SCOPE: "athena:commands",
  athenaIntegrationEnabled: () => cfg.enabled,
  athenaWebhookSecret: () => cfg.segredo,
}));

vi.mock("@/lib/impersonate/support", () => ({
  requireSupportWrite: vi.fn(async () => null),
}));

vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));

vi.mock("@/lib/api/auth-dual", () => ({
  resolveAuthDual: vi.fn(),
  tetoDeEscritaDoToken: vi.fn(async () => null),
}));

vi.mock("@/lib/integrations/athena/jobs", () => ({
  criarJobAthena: vi.fn(async () => "job-1"),
  lerJobAthena: vi.fn(async () => null),
  decidirJobAthena: vi.fn(),
  registarWebhookAthena: vi.fn(async () => EVENTO_ID),
}));

vi.mock("@/lib/api/idempotency", async (importOriginal) => {
  const orig = await importOriginal<{
    chaveDaRequisicao: (req: { headers: Headers }) => string | null;
  }>();
  return { chaveDaRequisicao: orig.chaveDaRequisicao, comIdempotencia: vi.fn() };
});

import { audit } from "@/lib/audit";
import { resolveAuthDual } from "@/lib/api/auth-dual";
import { registarWebhookAthena } from "@/lib/integrations/athena/jobs";

import { POST } from "./route";

const authOk = {
  ok: true,
  organizationId: ORG,
  actor: { type: "ai_agent", id: "agente-athena" },
  supabase: {},
  via: "token",
  scopes: ["athena:commands"],
  apiTokenId: "tok-1",
};

function assinar(corpo: string, segredo: string): string {
  return createHmac("sha256", segredo).update(corpo).digest("hex");
}

function pedido(corpo: string, assinatura?: string): NextRequest {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (assinatura !== undefined) headers["x-athena-signature"] = assinatura;
  return new NextRequest("http://localhost/api/v1/integrations/athena/webhook", {
    method: "POST",
    headers,
    body: corpo,
  });
}

const CORPO = JSON.stringify({ event: "mission.completed", data: { mission_id: "m1" } });

describe("POST /integrations/athena/webhook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cfg.enabled = true;
    cfg.segredo = SEGREDO_TESTE;
    vi.mocked(resolveAuthDual).mockResolvedValue(authOk as never);
  });

  it("assinatura válida → 201 e o evento fica registado na organização do token", async () => {
    const res = await POST(pedido(CORPO, assinar(CORPO, SEGREDO_TESTE)));
    expect(res.status).toBe(201);
    const body = (await res.json()) as { data: { received: boolean; event_id: string } };
    expect(body.data).toEqual({ received: true, event_id: EVENTO_ID });
    expect(registarWebhookAthena).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ organizationId: ORG, event: "mission.completed" }),
    );
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "athena.webhook_received", organizationId: ORG }),
    );
  });

  it("assinatura de outro segredo → 401, auditado, e nada registado", async () => {
    const res = await POST(pedido(CORPO, assinar(CORPO, OUTRO_SEGREDO)));
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("invalid_signature");
    expect(registarWebhookAthena).not.toHaveBeenCalled();
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "athena.webhook_invalid_signature" }),
    );
  });

  it("sem cabeçalho de assinatura → 401 e nada registado", async () => {
    const res = await POST(pedido(CORPO));
    expect(res.status).toBe(401);
    expect(registarWebhookAthena).not.toHaveBeenCalled();
  });

  it("corpo adulterado depois de assinar → 401", async () => {
    const res = await POST(pedido(`${CORPO} `, assinar(CORPO, SEGREDO_TESTE)));
    expect(res.status).toBe(401);
    expect(registarWebhookAthena).not.toHaveBeenCalled();
  });

  it("sem segredo configurado → 404 (fail-closed), mesmo com assinatura", async () => {
    cfg.segredo = "";
    const res = await POST(pedido(CORPO, assinar(CORPO, SEGREDO_TESTE)));
    expect(res.status).toBe(404);
    expect(registarWebhookAthena).not.toHaveBeenCalled();
  });

  it("sem Bearer válido → a recusa da auth e nada registado", async () => {
    vi.mocked(resolveAuthDual).mockResolvedValue({
      ok: false,
      response: new Response(JSON.stringify({ error: { code: "unauthorized" } }), {
        status: 401,
      }),
    } as never);
    const res = await POST(pedido(CORPO, assinar(CORPO, SEGREDO_TESTE)));
    expect(res.status).toBe(401);
    expect(registarWebhookAthena).not.toHaveBeenCalled();
  });
});
