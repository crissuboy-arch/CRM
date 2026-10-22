/**
 * POST /api/v1/integrations/athena/actions — as provas da rota:
 *
 *  - desligada, a rota é um 404 e nem tenta autenticar;
 *  - sem auth, nada se regista;
 *  - a `Idempotency-Key` é OBRIGATÓRIA (contrato §5): sem ela ou não-UUID
 *    é 400 `bad_request` e nada se regista;
 *  - com o token da organização, a ação nasce `pending_approval` DESSA
 *    organização — nunca executa;
 *  - tipo fora do catálogo é 422;
 *  - o replay de idempotência devolve a mesma ação sem registar outra.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { NextRequest } from "next/server";

const ORG = "22222222-2222-4222-8222-222222222222";
const ACTION_ID = "44444444-4444-4444-8444-444444444444";
const CHAVE = "55555555-5555-4555-8555-555555555555";
const CRIADA_EM = "2026-10-22T09:01:00.000Z";

const cfg = vi.hoisted(() => ({ enabled: true }));
const idem = vi.hoisted(() => ({
  porChave: new Map<string, { corpo: string; resposta: unknown }>(),
}));

vi.mock("@/lib/integrations/athena/config", () => ({
  ATHENA_SCOPE_ACTIONS: "athena:actions",
  athenaIntegrationEnabled: () => cfg.enabled,
}));

vi.mock("@/lib/impersonate/support", () => ({
  requireSupportWrite: vi.fn(async () => null),
}));

vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));

vi.mock("@/lib/api/auth-dual", () => ({
  tetoDeEscritaDoToken: vi.fn(async () => null),
}));

vi.mock("@/lib/integrations/athena/auth", () => ({
  autenticarAthena: vi.fn(),
}));

vi.mock("@/lib/integrations/athena/acoes", () => ({
  criarAcaoAthena: vi.fn(async () => ({
    action_id: ACTION_ID,
    organization_id: ORG,
    type: "messages.send",
    state: "pending_approval",
    reason: null,
    created_at: CRIADA_EM,
    decided_by: null,
    decided_at: null,
    decision_note: null,
    decided_by_role: null,
  })),
  lerAcaoAthena: vi.fn(async () => null),
  decidirAcaoAthena: vi.fn(),
  lerEvidenciaDaDecisaoAthena: vi.fn(async () => null),
}));

vi.mock("@/lib/api/idempotency", async (importOriginal) => {
  const orig = await importOriginal<{
    chaveDaRequisicao: (req: { headers: Headers }) => string | null;
  }>();
  return {
    chaveDaRequisicao: orig.chaveDaRequisicao,
    comIdempotencia: async (args: {
      organizationId: string;
      endpoint: string;
      chave: string;
      corpo: unknown;
      executar: () => Promise<{ resposta: unknown; status: number }>;
    }) => {
      const chaveCompleta = `${args.organizationId}|${args.endpoint}|${args.chave}`;
      const corpo = JSON.stringify(args.corpo);
      const existente = idem.porChave.get(chaveCompleta);
      if (existente) {
        if (existente.corpo !== corpo) return { tipo: "conflito" as const };
        return { tipo: "replay" as const, resposta: existente.resposta, status: 201, reciboId: "r1" };
      }
      const r = await args.executar();
      idem.porChave.set(chaveCompleta, { corpo, resposta: r.resposta });
      return { tipo: "executou" as const, resposta: r.resposta, status: r.status, reciboId: "r1" };
    },
  };
});

import { audit } from "@/lib/audit";
import { criarAcaoAthena } from "@/lib/integrations/athena/acoes";
import { autenticarAthena } from "@/lib/integrations/athena/auth";

import { POST } from "./route";

const authOk = {
  ok: true,
  organizationId: ORG,
  actor: { type: "ai_agent", id: "agente-athena" },
  supabase: {},
  via: "token",
  scopes: ["athena:actions"],
  apiTokenId: "tok-1",
};

function pedido(body: unknown, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest("http://localhost/api/v1/integrations/athena/actions", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

const COM_CHAVE = { "idempotency-key": CHAVE };

describe("POST /integrations/athena/actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    idem.porChave.clear();
    cfg.enabled = true;
    vi.mocked(autenticarAthena).mockResolvedValue(authOk as never);
  });

  it("desligada → 404, sem autenticar e sem registar", async () => {
    cfg.enabled = false;
    const res = await POST(pedido({ type: "messages.send" }, COM_CHAVE));
    expect(res.status).toBe(404);
    expect(autenticarAthena).not.toHaveBeenCalled();
    expect(criarAcaoAthena).not.toHaveBeenCalled();
  });

  it("sem auth → 401 e nenhum registo", async () => {
    vi.mocked(autenticarAthena).mockResolvedValue({
      ok: false,
      status: 401,
      code: "unauthorized",
      response: new Response(JSON.stringify({ error: { code: "unauthorized" } }), {
        status: 401,
      }),
    } as never);
    const res = await POST(pedido({ type: "messages.send" }, COM_CHAVE));
    expect(res.status).toBe(401);
    expect(criarAcaoAthena).not.toHaveBeenCalled();
  });

  it("sem Idempotency-Key → 400 bad_request e nenhum registo", async () => {
    const res = await POST(pedido({ type: "messages.send" }));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("bad_request");
    expect(criarAcaoAthena).not.toHaveBeenCalled();
  });

  it("Idempotency-Key não-UUID → 400 bad_request e nenhum registo", async () => {
    const res = await POST(pedido({ type: "messages.send" }, { "idempotency-key": "nao-e-uuid" }));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("bad_request");
    expect(criarAcaoAthena).not.toHaveBeenCalled();
  });

  it("com o token da organização → 201 e a ação nasce pending_approval", async () => {
    const res = await POST(
      pedido(
        { type: "messages.send", params: { conversation_id: "c1" }, reason: "lead novo" },
        COM_CHAVE,
      ),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      data: { action_id: string; type: string; state: string; created_at: string };
    };
    expect(body.data).toEqual({
      action_id: ACTION_ID,
      type: "messages.send",
      state: "pending_approval",
      created_at: CRIADA_EM,
    });
    // A organização é a do token — o corpo nem tem por onde a sugerir.
    expect(criarAcaoAthena).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ organizationId: ORG, type: "messages.send", apiTokenId: "tok-1" }),
    );
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "athena.command_received",
        organizationId: ORG,
        resourceType: "athena_action",
      }),
    );
    expect(autenticarAthena).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ scope: "athena:actions", role: "agent", resource: "athena_actions" }),
    );
  });

  it("tipo fora do catálogo → 422 e nenhum registo", async () => {
    const res = await POST(pedido({ type: "billing.charge" }, COM_CHAVE));
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("validation_failed");
    expect(criarAcaoAthena).not.toHaveBeenCalled();
  });

  it("replay de idempotência → a mesma ação, registada uma única vez", async () => {
    const corpo = { type: "contacts.create", params: { nome: "Maria" } };
    const primeira = await POST(pedido(corpo, COM_CHAVE));
    const segunda = await POST(pedido(corpo, COM_CHAVE));
    expect(primeira.status).toBe(201);
    expect(segunda.status).toBe(201);
    const b1 = (await primeira.json()) as { data: { action_id: string } };
    const b2 = (await segunda.json()) as { data: { action_id: string } };
    expect(b2.data.action_id).toBe(b1.data.action_id);
    expect(criarAcaoAthena).toHaveBeenCalledTimes(1);
  });

  it("mesma chave com outro corpo → 409 idempotency_conflict", async () => {
    await POST(pedido({ type: "contacts.create" }, COM_CHAVE));
    const res = await POST(pedido({ type: "messages.send" }, COM_CHAVE));
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("idempotency_conflict");
    expect(criarAcaoAthena).toHaveBeenCalledTimes(1);
  });
});
