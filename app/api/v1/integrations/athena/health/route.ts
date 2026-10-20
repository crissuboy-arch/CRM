/**
 * GET /api/v1/integrations/athena/health — a sonda do contrato Athena (v1).
 *
 * Responde sempre, ligada ou desligada: é assim que a Athena (ou um humano
 * a depurar) distingue "a integração está desligada" de "o endereço está
 * errado". Não exige auth e não revela nada da instalação — só o estado
 * da flag, a versão do contrato e o catálogo de comandos. Os comandos e
 * os webhooks, esses sim, respondem 404 enquanto a integração estiver
 * desligada. Contrato: `docs/integracao/athena.md`.
 */
import { randomUUID } from "node:crypto";

import { ok } from "@/lib/api/wrappers";
import { athenaIntegrationEnabled } from "@/lib/integrations/athena/config";
import { COMANDOS_ATHENA } from "@/lib/integrations/athena/contrato";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const requestId = randomUUID();
  return ok(
    {
      service: "athena-integration",
      version: "v1",
      enabled: athenaIntegrationEnabled(),
      commands: [...COMANDOS_ATHENA],
    },
    { requestId },
  );
}
