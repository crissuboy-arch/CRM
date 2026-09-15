import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/channels/adapters/waha", () => ({ wahaAdapter: { provider: "waha" } }));
vi.mock("@/lib/channels/adapters/meta-cloud", () => ({ metaCloudAdapter: { provider: "meta_cloud" } }));
vi.mock("@/lib/channels/adapters/zernio", () => ({ zernioAdapter: { provider: "zernio" } }));
import { getAdapter, resolveSessionRef, channelIsAvailable, capabilitiesOf } from "@/lib/channels";
import { nomeiaProvider } from "../../scripts/lint-channels.pattern";

describe("PHASE 1 — Instagram reconhecido e indisponível", () => {
  it("resolve a conta Instagram sem confundir o identificador do WhatsApp", () => {
    expect(resolveSessionRef({ provider: "instagram_meta", instagram_account_id: "ig-account" })).toBe("ig-account");
    expect(resolveSessionRef({ provider: "meta_cloud", meta_phone_number_id: "wa-number" })).toBe("wa-number");
  });
  it("barra o transporte mesmo que alguém obtenha uma sessão por fora da UI", () => {
    expect(channelIsAvailable("instagram_meta")).toBe(false);
    expect(() => getAdapter("instagram_meta")).toThrow("channel_unavailable");
    for (const provider of ["waha", "meta_cloud", "zernio"] as const) {
      expect(channelIsAvailable(provider)).toBe(true);
      expect(getAdapter(provider).provider).toBe(provider);
    }
  });
  it("não herda templates, grupos ou envio fora da janela do WhatsApp", () => {
    expect(capabilitiesOf("instagram_meta")).toMatchObject({
      requiresTemplates: false, canManageTemplates: false,
      freeformOutsideWindow: false, groups: "none", costPerMessage: false,
    });
  });
  it("inclui o provider na cerca de dependências de canal", () => {
    expect(nomeiaProvider('provider === "instagram_meta"')).toBe(true);
  });
});
