/**
 * `autenticarAthena` — o wrapper sobre a auth dual da casa:
 *
 *  - o sucesso passa intacto (o wrapper não toca no que a casa decidiu);
 *  - a falha passa com o código que o corpo original nomeia;
 *  - token VÁLIDO sem o escopo da rota é a única falha que o wrapper
 *    renomeia: `403 forbidden` com `required_scope`, como o contrato
 *    promete (§2.2);
 *  - token válido COM o escopo mas papel insuficiente, e token que nem
 *    valida, devolvem a resposta original intacta — a razão não era
 *    escopo e o wrapper não adivinha.
 */
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { fail } from "@/lib/api/wrappers";

const mocks = vi.hoisted(() => ({
  resolveAuthDual: vi.fn(),
  validateBearerToken: vi.fn(),
}));

vi.mock("@/lib/api/auth-dual", () => ({ resolveAuthDual: mocks.resolveAuthDual }));

vi.mock("@/lib/mcp/auth", () => ({
  validateBearerToken: mocks.validateBearerToken,
  // Implementação simples do real: extrai o token de `Bearer <token>`.
  extractBearer: (header: string | null) => {
    if (!header) return null;
    const m = /^Bearer\s+(.+)$/i.exec(header.trim());
    return m ? m[1]!.trim() : null;
  },
}));

import { autenticarAthena } from "./auth";

const ORG = "22222222-2222-4222-8222-222222222222";
const OPTS = {
  requestId: "req-teste",
  resource: "athena_actions",
  role: "agent",
  scope: "athena:actions",
} as const;

function pedidoComBearer(): NextRequest {
  return new NextRequest("http://localhost/api/v1/integrations/athena/actions", {
    headers: { authorization: "Bearer dsk_teste" },
  });
}

function pedidoSemBearer(): NextRequest {
  return new NextRequest("http://localhost/api/v1/integrations/athena/actions");
}

describe("autenticarAthena", () => {
  beforeEach(() => {
    mocks.resolveAuthDual.mockReset();
    mocks.validateBearerToken.mockReset();
  });

  it("o sucesso do resolveAuthDual passa intacto", async () => {
    const sucesso = {
      ok: true,
      organizationId: ORG,
      actor: { type: "api_token", id: "tok-1", role: "agent" },
      supabase: {},
      via: "token",
      scopes: ["athena:actions"],
      apiTokenId: "tok-1",
    };
    mocks.resolveAuthDual.mockResolvedValue(sucesso);
    const resultado = await autenticarAthena(pedidoComBearer(), OPTS);
    expect(resultado).toBe(sucesso);
    expect(mocks.validateBearerToken).not.toHaveBeenCalled();
  });

  it("um 401 passa com o código que o corpo original nomeia", async () => {
    const resposta = fail("token_expired", "Token expired.", 401, { requestId: OPTS.requestId });
    mocks.resolveAuthDual.mockResolvedValue({ ok: false, response: resposta });
    const resultado = await autenticarAthena(pedidoSemBearer(), OPTS);
    if (resultado.ok) throw new Error("esperava falha");
    expect(resultado.status).toBe(401);
    expect(resultado.code).toBe("token_expired");
    expect(resultado.response).toBe(resposta);
    expect(resultado.requiredScope).toBeUndefined();
  });

  it("token válido sem o escopo → 403 forbidden com required_scope no corpo", async () => {
    const resposta = fail("forbidden_role", "Papel insuficiente.", 403, {
      requestId: OPTS.requestId,
    });
    mocks.resolveAuthDual.mockResolvedValue({ ok: false, response: resposta });
    mocks.validateBearerToken.mockResolvedValue({
      organizationId: ORG,
      role: "agent",
      actor: { type: "api_token", id: "tok-1", role: "agent" },
      apiTokenId: "tok-1",
      scopes: ["athena:stats"],
    });
    const resultado = await autenticarAthena(pedidoComBearer(), OPTS);
    if (resultado.ok) throw new Error("esperava falha");
    expect(resultado.status).toBe(403);
    expect(resultado.code).toBe("forbidden");
    expect(resultado.requiredScope).toBe("athena:actions");
    expect(resultado.response).not.toBe(resposta);
    const corpo = (await resultado.response.json()) as {
      error: { code: string; details?: { required_scope?: string } };
    };
    expect(corpo.error.code).toBe("forbidden");
    expect(corpo.error.details?.required_scope).toBe("athena:actions");
  });

  it("token válido com o escopo mas papel insuficiente → resposta original intacta", async () => {
    const resposta = fail("forbidden_role", "Papel insuficiente.", 403, {
      requestId: OPTS.requestId,
    });
    mocks.resolveAuthDual.mockResolvedValue({ ok: false, response: resposta });
    mocks.validateBearerToken.mockResolvedValue({
      organizationId: ORG,
      role: "viewer",
      actor: { type: "api_token", id: "tok-1", role: "viewer" },
      apiTokenId: "tok-1",
      scopes: ["athena:actions"],
    });
    const resultado = await autenticarAthena(pedidoComBearer(), OPTS);
    if (resultado.ok) throw new Error("esperava falha");
    expect(resultado.status).toBe(403);
    expect(resultado.code).toBe("forbidden_role");
    expect(resultado.response).toBe(resposta);
    expect(resultado.requiredScope).toBeUndefined();
  });

  it("validateBearerToken a lançar → resposta original intacta", async () => {
    const resposta = fail("forbidden_role", "Papel insuficiente.", 403, {
      requestId: OPTS.requestId,
    });
    mocks.resolveAuthDual.mockResolvedValue({ ok: false, response: resposta });
    mocks.validateBearerToken.mockRejectedValue(new Error("token revogado"));
    const resultado = await autenticarAthena(pedidoComBearer(), OPTS);
    if (resultado.ok) throw new Error("esperava falha");
    expect(resultado.status).toBe(403);
    expect(resultado.code).toBe("forbidden_role");
    expect(resultado.response).toBe(resposta);
  });
});
