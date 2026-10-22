/**
 * GET /api/v1/integrations/athena/health — a sonda responde sempre, em JSON
 * PLANO (o formato da Athena Control, sem envelope), e diz a verdade da
 * flag: ligada ou desligada, nunca um 404 que se confunda com "endereço
 * errado".
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const cfg = vi.hoisted(() => ({ enabled: false }));

vi.mock("@/lib/integrations/athena/config", () => ({
  ATHENA_CONTRACT_VERSION: "v1",
  ATHENA_VERSAO_DO_PRODUTO: "0.1.0",
  athenaIntegrationEnabled: () => cfg.enabled,
}));

import { GET } from "./route";

describe("GET /integrations/athena/health", () => {
  beforeEach(() => {
    cfg.enabled = false;
  });

  it("desligada: 200 plano com enabled=false e contract v1", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.data).toBeUndefined();
    expect(body.platform).toBe("NEXORA CRM");
    expect(body.status).toBe("operational");
    expect(body.version).toBe("0.1.0");
    expect(body.contract).toBe("v1");
    expect(body.enabled).toBe(false);
    expect(body.capabilities).toEqual(["integrations:health"]);
    expect(typeof body.timestamp).toBe("string");
  });

  it("ligada: enabled=true, no mesmo formato plano", async () => {
    cfg.enabled = true;
    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.data).toBeUndefined();
    expect(body.enabled).toBe(true);
    expect(body.platform).toBe("NEXORA CRM");
    expect(body.capabilities).toEqual(["integrations:health"]);
  });
});
