/**
 * GET /api/v1/integrations/athena/stats — as provas da rota plana:
 *
 *  - desligada, responde 404 PLANO e nem tenta autenticar;
 *  - a falha de auth sai no formato plano, com `required_scope` quando a
 *    credencial não tem o escopo `athena:stats`;
 *  - o sucesso é JSON plano com os grupos de agregados DA ORGANIZAÇÃO DA
 *    CREDENCIAL — a camada de estatísticas é chamada com o organizationId
 *    resolvido da auth, nunca com outra coisa;
 *  - por token, o limite de 60/min estourado responde 429 com Retry-After.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { NextRequest } from "next/server";

const ORG = "22222222-2222-4222-8222-222222222222";

const cfg = vi.hoisted(() => ({ enabled: true }));

vi.mock("@/lib/integrations/athena/config", () => ({
  ATHENA_SCOPE_STATS: "athena:stats",
  athenaIntegrationEnabled: () => cfg.enabled,
}));

vi.mock("@/lib/integrations/athena/auth", () => ({
  autenticarAthena: vi.fn(),
}));

vi.mock("@/lib/integrations/athena/estatisticas", () => ({
  estatisticasDaOrganizacao: vi.fn(async () => ({
    organization: { id: ORG, name: "Empresa Exemplo" },
    conversations: { open: 12, in_progress: 5, closed_30d: 148 },
    leads: { total: 320, new_30d: 41 },
    contacts: { total: 512 },
    agents: { configured: 2, active: 1, runs_30d: 96 },
    support: { cases_open: 3 },
  })),
  nomeDaOrganizacao: vi.fn(async () => "Empresa Exemplo"),
  resumoDoAgenteDaOrganizacao: vi.fn(async () => ({ configured: true, active: true })),
}));

vi.mock("@/lib/ai/dispatcher/rate-limit", () => ({
  checkRateLimit: vi.fn(async () => ({ allowed: true, count: 1, limit: 60, window_sec: 60 })),
}));

import { checkRateLimit } from "@/lib/ai/dispatcher/rate-limit";
import { autenticarAthena } from "@/lib/integrations/athena/auth";
import { estatisticasDaOrganizacao } from "@/lib/integrations/athena/estatisticas";

import { GET } from "./route";

const authOk = {
  ok: true,
  organizationId: ORG,
  actor: { type: "ai_agent", id: "agente-athena" },
  supabase: { cliente: "da-auth" },
  via: "token",
  scopes: ["athena:stats"],
  apiTokenId: "tok-1",
};

function pedido(): NextRequest {
  return new NextRequest("http://localhost/api/v1/integrations/athena/stats");
}

describe("GET /integrations/athena/stats", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cfg.enabled = true;
    vi.mocked(autenticarAthena).mockResolvedValue(authOk as never);
    vi.mocked(checkRateLimit).mockResolvedValue({
      allowed: true,
      count: 1,
      limit: 60,
      window_sec: 60,
    } as never);
  });

  it("desligada → 404 plano, sem autenticar", async () => {
    cfg.enabled = false;
    const res = await GET(pedido());
    expect(res.status).toBe(404);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toEqual({ error: "not_found" });
    expect(autenticarAthena).not.toHaveBeenCalled();
    expect(estatisticasDaOrganizacao).not.toHaveBeenCalled();
  });

  it("auth 401 → erro plano com o código da auth", async () => {
    vi.mocked(autenticarAthena).mockResolvedValue({
      ok: false,
      status: 401,
      code: "token_invalid",
    } as never);
    const res = await GET(pedido());
    expect(res.status).toBe(401);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toEqual({ error: "token_invalid" });
    expect(estatisticasDaOrganizacao).not.toHaveBeenCalled();
  });

  it("auth 403 com requiredScope → corpo plano com required_scope", async () => {
    vi.mocked(autenticarAthena).mockResolvedValue({
      ok: false,
      status: 403,
      code: "forbidden",
      requiredScope: "athena:stats",
    } as never);
    const res = await GET(pedido());
    expect(res.status).toBe(403);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toEqual({ error: "forbidden", required_scope: "athena:stats" });
    expect(estatisticasDaOrganizacao).not.toHaveBeenCalled();
  });

  it("sucesso → plano com os grupos e a organização da credencial", async () => {
    const res = await GET(pedido());
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown> & {
      organization: { id: string };
      generated_at: string;
      timestamp: string;
    };
    expect(body.data).toBeUndefined();
    expect(body.platform).toBe("NEXORA CRM");
    expect(body.contract).toBe("v1");
    expect(body.organization).toEqual({ id: ORG, name: "Empresa Exemplo" });
    expect(body.conversations).toEqual({ open: 12, in_progress: 5, closed_30d: 148 });
    expect(body.leads).toEqual({ total: 320, new_30d: 41 });
    expect(body.generated_at).toBe(body.timestamp);
    // A organização consultada é a da credencial resolvida pela auth.
    expect(estatisticasDaOrganizacao).toHaveBeenCalledWith(authOk.supabase, ORG);
    expect(autenticarAthena).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ scope: "athena:stats", role: "viewer", resource: "athena_stats" }),
    );
  });

  it("limite por credencial excedido → 429 com Retry-After", async () => {
    vi.mocked(checkRateLimit).mockResolvedValue({
      allowed: false,
      count: 61,
      limit: 60,
      window_sec: 60,
    } as never);
    const res = await GET(pedido());
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("60");
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toEqual({ error: "rate_limited" });
    expect(checkRateLimit).toHaveBeenCalledWith("athena_stats:tok:tok-1", 60, 60);
    expect(estatisticasDaOrganizacao).not.toHaveBeenCalled();
  });
});
