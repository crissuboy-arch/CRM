/**
 * GET /api/v1/integrations/athena/actions/[id]/approval — as provas da
 * evidência de aprovação humana:
 *
 *  - pendente não é erro: 200 com `approval_ref: null` e `decision: null`;
 *  - decidida, devolve o recibo completo — `approval_ref` no formato
 *    `nexora://actions/<id>/approval`, a decisão, quem decidiu (utilizador
 *    e papel) e a referência do registo de auditoria que a prova;
 *  - ação de outra organização → 404, como nas outras rotas.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { NextRequest } from "next/server";

const ORG = "22222222-2222-4222-8222-222222222222";
const ACTION_ID = "44444444-4444-4444-8444-444444444444";
const USER = "11111111-1111-4111-8111-111111111111";
const LOG_ID = "66666666-6666-4666-8666-666666666666";

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

import {
  lerAcaoAthena,
  lerEvidenciaDaDecisaoAthena,
} from "@/lib/integrations/athena/acoes";
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

const base = {
  action_id: ACTION_ID,
  organization_id: ORG,
  type: "messages.send",
  reason: "o lead pediu uma proposta",
  created_at: "2026-10-22T09:01:00.000Z",
};

function chamar(): Promise<Response> {
  return GET(
    new NextRequest(`http://localhost/api/v1/integrations/athena/actions/${ACTION_ID}/approval`),
    { params: Promise.resolve({ id: ACTION_ID }) },
  );
}

describe("GET /integrations/athena/actions/[id]/approval", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cfg.enabled = true;
    vi.mocked(autenticarAthena).mockResolvedValue(authOk as never);
    vi.mocked(lerAcaoAthena).mockResolvedValue(null as never);
    vi.mocked(lerEvidenciaDaDecisaoAthena).mockResolvedValue(null as never);
  });

  it("pendente → 200 com approval_ref e decision nulos", async () => {
    vi.mocked(lerAcaoAthena).mockResolvedValue({
      ...base,
      state: "pending_approval",
      decided_by: null,
      decided_at: null,
      decision_note: null,
      decided_by_role: null,
    } as never);
    const res = await chamar();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: Record<string, unknown> };
    expect(body.data).toEqual({
      action_id: ACTION_ID,
      state: "pending_approval",
      approval_ref: null,
      decision: null,
    });
    expect(lerEvidenciaDaDecisaoAthena).not.toHaveBeenCalled();
  });

  it("decidida → o recibo completo da decisão humana", async () => {
    vi.mocked(lerAcaoAthena).mockResolvedValue({
      ...base,
      state: "approved",
      decided_by: USER,
      decided_at: "2026-10-22T09:05:31.000Z",
      decision_note: "pode enviar",
      decided_by_role: "admin",
    } as never);
    vi.mocked(lerEvidenciaDaDecisaoAthena).mockResolvedValue({
      log_id: LOG_ID,
      action: "athena.command_approved",
      actor_user_id: USER,
      created_at: "2026-10-22T09:05:31.000Z",
    } as never);
    const res = await chamar();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: Record<string, unknown> };
    expect(body.data).toEqual({
      action_id: ACTION_ID,
      state: "approved",
      approval_ref: `nexora://actions/${ACTION_ID}/approval`,
      decision: "approve",
      decided_by: { user_id: USER, role: "admin" },
      decided_at: "2026-10-22T09:05:31.000Z",
      note: "pode enviar",
      audit: { log_id: LOG_ID, action: "athena.command_approved" },
    });
  });

  it("ação de outra organização → 404", async () => {
    const res = await chamar();
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("not_found");
    expect(lerEvidenciaDaDecisaoAthena).not.toHaveBeenCalled();
  });
});
