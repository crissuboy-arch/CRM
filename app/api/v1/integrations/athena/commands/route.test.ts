/**
 * POST /api/v1/integrations/athena/commands — as provas da rota:
 *
 *  - desligada, a rota é um 404 e nem tenta autenticar;
 *  - sem auth (ou sem o escopo), nada se regista;
 *  - com o token da organização, o comando vira um job
 *    `pending_approval` DESSA organização — nunca executa;
 *  - comando fora do catálogo é 422;
 *  - o replay de idempotência devolve o mesmo job sem registar outro.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { NextRequest } from "next/server";

const ORG = "22222222-2222-4222-8222-222222222222";
const JOB_ID = "44444444-4444-4444-8444-444444444444";
const CHAVE = "55555555-5555-4555-8555-555555555555";

const cfg = vi.hoisted(() => ({ enabled: true }));
const idem = vi.hoisted(() => ({
  porChave: new Map<string, { corpo: string; resposta: unknown }>(),
}));

vi.mock("@/lib/integrations/athena/config", () => ({
  ATHENA_SCOPE: "athena:commands",
  athenaIntegrationEnabled: () => cfg.enabled,
  athenaWebhookSecret: () => "",
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
  criarJobAthena: vi.fn(async () => JOB_ID),
  lerJobAthena: vi.fn(async () => null),
  decidirJobAthena: vi.fn(),
  registarWebhookAthena: vi.fn(async () => "evt-1"),
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
import { resolveAuthDual } from "@/lib/api/auth-dual";
import { criarJobAthena } from "@/lib/integrations/athena/jobs";

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

function pedido(body: unknown, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest("http://localhost/api/v1/integrations/athena/commands", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

describe("POST /integrations/athena/commands", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    idem.porChave.clear();
    cfg.enabled = true;
    vi.mocked(resolveAuthDual).mockResolvedValue(authOk as never);
  });

  it("desligada → 404, sem autenticar e sem registar", async () => {
    cfg.enabled = false;
    const res = await POST(pedido({ command: "messages.send" }));
    expect(res.status).toBe(404);
    expect(resolveAuthDual).not.toHaveBeenCalled();
    expect(criarJobAthena).not.toHaveBeenCalled();
  });

  it("sem auth → a recusa da auth e nenhum job", async () => {
    vi.mocked(resolveAuthDual).mockResolvedValue({
      ok: false,
      response: new Response(JSON.stringify({ error: { code: "unauthorized" } }), {
        status: 401,
      }),
    } as never);
    const res = await POST(pedido({ command: "messages.send" }));
    expect(res.status).toBe(401);
    expect(criarJobAthena).not.toHaveBeenCalled();
  });

  it("com o token da organização → 201 e o job nasce pending_approval", async () => {
    const res = await POST(
      pedido({ command: "messages.send", params: { conversation_id: "c1" }, reason: "lead novo" }),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      data: { job_id: string; command: string; state: string };
    };
    expect(body.data).toEqual({
      job_id: JOB_ID,
      command: "messages.send",
      state: "pending_approval",
    });
    // A organização é a do token — o corpo nem tem por onde a sugerir.
    expect(criarJobAthena).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ organizationId: ORG, command: "messages.send" }),
    );
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "athena.command_received", organizationId: ORG }),
    );
  });

  it("comando fora do catálogo → 422 e nenhum job", async () => {
    const res = await POST(pedido({ command: "billing.charge" }));
    expect(res.status).toBe(422);
    expect(criarJobAthena).not.toHaveBeenCalled();
  });

  it("replay de idempotência → o mesmo job, registado uma única vez", async () => {
    const headers = { "idempotency-key": CHAVE };
    const corpo = { command: "contacts.create", params: { nome: "Maria" } };
    const primeira = await POST(pedido(corpo, headers));
    const segunda = await POST(pedido(corpo, headers));
    expect(primeira.status).toBe(201);
    expect(segunda.status).toBe(201);
    const b1 = (await primeira.json()) as { data: { job_id: string } };
    const b2 = (await segunda.json()) as { data: { job_id: string } };
    expect(b2.data.job_id).toBe(b1.data.job_id);
    expect(criarJobAthena).toHaveBeenCalledTimes(1);
  });

  it("mesma chave com outro corpo → 409 idempotency_conflict", async () => {
    const headers = { "idempotency-key": CHAVE };
    await POST(pedido({ command: "contacts.create" }, headers));
    const res = await POST(pedido({ command: "messages.send" }, headers));
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("idempotency_conflict");
    expect(criarJobAthena).toHaveBeenCalledTimes(1);
  });
});
