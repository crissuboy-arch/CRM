/**
 * GET /api/v1/integrations/athena/actions/[id] — as provas da consulta:
 *
 *  - uma ação de outra organização é invisível à camada de dados e a rota
 *    responde 404, indistinto de inexistente;
 *  - a resposta traz o estado e os carimbos, mas NUNCA os `params` (podem
 *    conter dados de clientes) nem `decided_by` — quem decidiu prova-se na
 *    rota de approval, não aqui;
 *  - decidida, `decided_at` vem preenchido.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { NextRequest } from "next/server";

const ORG = "22222222-2222-4222-8222-222222222222";
const ACTION_ID = "44444444-4444-4444-8444-444444444444";
const USER = "11111111-1111-4111-8111-111111111111";

const cfg = vi.hoisted(() => ({ enabled: true }));

vi.mock("@/lib/integrations/athena/config", () => ({
  ATHENA_SCOPE_ACTIONS: "athena:actions",
  athenaIntegrationEnabled: () => cfg.enabled,
}));

vi.mock("@/lib/integrations/athena/auth", () => ({
  autenticarAthena: vi.fn(),
}));

vi.mock("@/lib/integrations/athena/acoes", () => ({
  criarAcaoAthena: vi.fn(),
  lerAcaoAthena: vi.fn(async () => null),
  decidirAcaoAthena: vi.fn(),
  lerEvidenciaDaDecisaoAthena: vi.fn(async () => null),
}));

import { lerAcaoAthena } from "@/lib/integrations/athena/acoes";
import { autenticarAthena } from "@/lib/integrations/athena/auth";

import { GET } from "./route";

const authOk = {
  ok: true,
  organizationId: ORG,
  actor: { type: "ai_agent", id: "agente-athena" },
  supabase: {},
  via: "token",
  scopes: ["athena:actions"],
  apiTokenId: "tok-1",
};

const acaoPendente = {
  action_id: ACTION_ID,
  organization_id: ORG,
  type: "messages.send",
  state: "pending_approval",
  reason: "o lead pediu uma proposta",
  created_at: "2026-10-22T09:01:00.000Z",
  decided_by: null,
  decided_at: null,
  decision_note: null,
  decided_by_role: null,
};

function chamar(id: string = ACTION_ID): Promise<Response> {
  return GET(new NextRequest(`http://localhost/api/v1/integrations/athena/actions/${id}`), {
    params: Promise.resolve({ id }),
  });
}

describe("GET /integrations/athena/actions/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cfg.enabled = true;
    vi.mocked(autenticarAthena).mockResolvedValue(authOk as never);
    vi.mocked(lerAcaoAthena).mockResolvedValue(null as never);
  });

  it("ação de outra organização (invisível à camada de dados) → 404", async () => {
    const res = await chamar();
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("not_found");
    // A leitura é sempre filtrada pela organização da credencial.
    expect(lerAcaoAthena).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ organizationId: ORG, actionId: ACTION_ID }),
    );
  });

  it("pendente → 200 sem params e sem decided_by no corpo", async () => {
    vi.mocked(lerAcaoAthena).mockResolvedValue(acaoPendente as never);
    const res = await chamar();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: Record<string, unknown> };
    expect(body.data).toEqual({
      action_id: ACTION_ID,
      type: "messages.send",
      state: "pending_approval",
      reason: "o lead pediu uma proposta",
      created_at: "2026-10-22T09:01:00.000Z",
      decided_at: null,
    });
    expect(body.data).not.toHaveProperty("params");
    expect(body.data).not.toHaveProperty("decided_by");
  });

  it("decidida → decided_at presente", async () => {
    vi.mocked(lerAcaoAthena).mockResolvedValue({
      ...acaoPendente,
      state: "approved",
      decided_by: USER,
      decided_at: "2026-10-22T09:05:31.000Z",
      decision_note: "pode enviar",
      decided_by_role: "admin",
    } as never);
    const res = await chamar();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: Record<string, unknown> };
    expect(body.data.state).toBe("approved");
    expect(body.data.decided_at).toBe("2026-10-22T09:05:31.000Z");
    expect(body.data).not.toHaveProperty("decided_by");
  });
});
