/**
 * Contrato de boot em produção (incidente do staging NEXORA, 2026-10-20):
 * com NODE_ENV=production e apenas as 3 variáveis do Supabase configuradas
 * (o estado em que o projeto Vercel de staging foi criado), importar
 * `@/lib/env` tem de lançar nomeando as obrigatórias em falta — é esse throw,
 * no import feito por `proxy.ts` e por `app/layout.tsx`, que derruba TODAS
 * as páginas com 500 ("Internal Server Error") até a configuração ficar
 * completa. O segundo caso é o controlo: com as 13 obrigatórias presentes,
 * o módulo importa sem lançar. Ver docs/STAGING-SETUP.md §3.1 e o incidente.
 */
import { describe, it, expect, vi, afterEach } from "vitest";

const OBRIGATORIAS_EM_FALTA = [
  "INTERNAL_SECRET",
  "CPF_ENCRYPTION_KEY",
  "WAHA_BYO_ENCRYPTION_KEY",
  "AI_CRED_AES_KEY",
  "SUPABASE_DB_URL",
  "WAHA_API_BASE_URL",
  "WAHA_API_KEY",
  "WAHA_WEBHOOK_BASE_URL",
  "UPSTASH_REDIS_REST_URL",
  "UPSTASH_REDIS_REST_TOKEN",
];

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

function stubDasTresDoSupabase() {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv(
    "NEXT_PUBLIC_SUPABASE_URL",
    "https://aycfntfpbjsdvbfxntzw.supabase.co",
  );
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "dummy-anon");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "dummy-service");
}

describe("boot em produção sem as obrigatórias (incidente staging 2026-10-20)", () => {
  it("lança ao importar lib/env só com as 3 vars do Supabase", async () => {
    stubDasTresDoSupabase();
    for (const k of OBRIGATORIAS_EM_FALTA) vi.stubEnv(k, undefined);
    vi.resetModules();
    await expect(import("@/lib/env")).rejects.toThrow(
      "Variáveis de ambiente inválidas",
    );
  });

  it("NÃO lança quando as 13 obrigatórias estão presentes", async () => {
    stubDasTresDoSupabase();
    vi.stubEnv("INTERNAL_SECRET", "x".repeat(32));
    vi.stubEnv("CPF_ENCRYPTION_KEY", "dummy");
    vi.stubEnv("WAHA_BYO_ENCRYPTION_KEY", "dummy");
    vi.stubEnv("AI_CRED_AES_KEY", "dummy");
    vi.stubEnv("SUPABASE_DB_URL", "postgres://dummy:dummy@127.0.0.1:5432/dummy");
    vi.stubEnv("WAHA_API_BASE_URL", "http://127.0.0.1:3001");
    vi.stubEnv("WAHA_API_KEY", "dummy");
    vi.stubEnv("WAHA_WEBHOOK_BASE_URL", "https://example.invalid");
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://example.invalid");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "dummy");
    vi.resetModules();
    const mod = await import("@/lib/env");
    expect(mod.env.NEXT_PUBLIC_SUPABASE_URL).toContain("supabase.co");
  });
});
