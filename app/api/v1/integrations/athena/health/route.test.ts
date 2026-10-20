/**
 * GET /api/v1/integrations/athena/health — a sonda responde sempre e diz a
 * verdade da flag: ligada ou desligada, nunca um 404 que se confunda com
 * "endereço errado".
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const cfg = vi.hoisted(() => ({ enabled: false }));

vi.mock("@/lib/integrations/athena/config", () => ({
  ATHENA_SCOPE: "athena:commands",
  athenaIntegrationEnabled: () => cfg.enabled,
  athenaWebhookSecret: () => "",
}));

import { GET } from "./route";

describe("GET /integrations/athena/health", () => {
  beforeEach(() => {
    cfg.enabled = false;
  });

  it("desligada: 200 com enabled=false (a omissão é desligada)", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { enabled: boolean; version: string } };
    expect(body.data.enabled).toBe(false);
    expect(body.data.version).toBe("v1");
  });

  it("ligada: enabled=true e o catálogo de comandos é o do contrato", async () => {
    cfg.enabled = true;
    const res = await GET();
    const body = (await res.json()) as { data: { enabled: boolean; commands: string[] } };
    expect(body.data.enabled).toBe(true);
    expect(body.data.commands).toEqual([
      "contacts.create",
      "messages.send",
      "appointments.create",
      "reports.generate",
    ]);
  });
});
