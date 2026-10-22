/**
 * GET /api/v1/integrations/athena/capabilities — as provas da rota plana:
 *
 *  - desligada, 404 plano sem autenticar;
 *  - credencial sem o escopo `athena:capabilities` → 403 plano com
 *    `required_scope`;
 *  - o sucesso anuncia o catálogo fechado do contrato: 4 ações, TODAS
 *    sensíveis e com aprovação humana obrigatória, os estados da ação, o
 *    resumo do agente da organização e `integration.enabled: true`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { NextRequest } from "next/server";

const ORG = "22222222-2222-4222-8222-222222222222";

const cfg = vi.hoisted(() => ({ enabled: true }));

vi.mock("@/lib/integrations/athena/config", () => ({
  ATHENA_SCOPE_CAPABILITIES: "athena:capabilities",
  athenaIntegrationEnabled: () => cfg.enabled,
}));

vi.mock("@/lib/integrations/athena/auth", () => ({
  autenticarAthena: vi.fn(),
}));

vi.mock("@/lib/integrations/athena/estatisticas", () => ({
  estatisticasDaOrganizacao: vi.fn(async () => ({})),
  nomeDaOrganizacao: vi.fn(async () => "Empresa Exemplo"),
  resumoDoAgenteDaOrganizacao: vi.fn(async () => ({ configured: true, active: false })),
}));

import { autenticarAthena } from "@/lib/integrations/athena/auth";
import {
  nomeDaOrganizacao,
  resumoDoAgenteDaOrganizacao,
} from "@/lib/integrations/athena/estatisticas";

import { GET } from "./route";

const authOk = {
  ok: true,
  organizationId: ORG,
  actor: { type: "ai_agent", id: "agente-athena" },
  supabase: { cliente: "da-auth" },
  via: "token",
  scopes: ["athena:capabilities"],
  apiTokenId: "tok-1",
};

function pedido(): NextRequest {
  return new NextRequest("http://localhost/api/v1/integrations/athena/capabilities");
}

describe("GET /integrations/athena/capabilities", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cfg.enabled = true;
    vi.mocked(autenticarAthena).mockResolvedValue(authOk as never);
  });

  it("desligada → 404 plano, sem autenticar", async () => {
    cfg.enabled = false;
    const res = await GET(pedido());
    expect(res.status).toBe(404);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toEqual({ error: "not_found" });
    expect(autenticarAthena).not.toHaveBeenCalled();
  });

  it("escopo errado → 403 plano com required_scope", async () => {
    vi.mocked(autenticarAthena).mockResolvedValue({
      ok: false,
      status: 403,
      code: "forbidden",
      requiredScope: "athena:capabilities",
    } as never);
    const res = await GET(pedido());
    expect(res.status).toBe(403);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toEqual({ error: "forbidden", required_scope: "athena:capabilities" });
    expect(nomeDaOrganizacao).not.toHaveBeenCalled();
  });

  it("sucesso → catálogo do contrato, tudo sensível e com aprovação", async () => {
    const res = await GET(pedido());
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data?: unknown;
      platform: string;
      contract: string;
      organization: { id: string; name: string };
      integration: { enabled: boolean };
      actions: { type: string; sensitive: boolean; requires_approval: boolean }[];
      action_states: string[];
      agent: { configured: boolean; active: boolean };
    };
    expect(body.data).toBeUndefined();
    expect(body.platform).toBe("NEXORA CRM");
    expect(body.contract).toBe("v1");
    expect(body.organization).toEqual({ id: ORG, name: "Empresa Exemplo" });
    expect(body.integration).toEqual({ enabled: true });
    expect(body.actions.map((a) => a.type)).toEqual([
      "contacts.create",
      "messages.send",
      "appointments.create",
      "reports.generate",
    ]);
    for (const acao of body.actions) {
      expect(acao.sensitive).toBe(true);
      expect(acao.requires_approval).toBe(true);
    }
    expect(body.action_states).toEqual(["pending_approval", "approved", "rejected"]);
    expect(body.agent).toEqual({ configured: true, active: false });
    expect(resumoDoAgenteDaOrganizacao).toHaveBeenCalledWith(authOk.supabase, ORG);
    expect(autenticarAthena).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        scope: "athena:capabilities",
        role: "viewer",
        resource: "athena_capabilities",
      }),
    );
  });
});
