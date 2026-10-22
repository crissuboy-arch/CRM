/**
 * GET /api/v1/integrations/athena/health — a sonda do contrato oficial
 * Athena ↔ NEXORA (v1).
 *
 * Responde SEMPRE, ligada ou desligada: é assim que a Athena Control (ou um
 * humano a depurar) distingue "a integração está desligada" de "o endereço
 * está errado". Sem autenticação, sem acesso a dados, sem efeitos
 * colaterais — e em JSON PLANO, no formato que a Control já consome dos
 * outros produtos (sem o envelope `data` das rotas de ações).
 *
 * Contrato: `docs/integracao/athena.md` (§3.1).
 */
import { randomUUID } from "node:crypto";

import {
  ATHENA_CONTRACT_VERSION,
  ATHENA_VERSAO_DO_PRODUTO,
  athenaIntegrationEnabled,
} from "@/lib/integrations/athena/config";
import { respostaPlana } from "@/lib/integrations/athena/respostas";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const requestId = randomUUID();
  return respostaPlana(
    {
      platform: "NEXORA CRM",
      status: "operational",
      version: ATHENA_VERSAO_DO_PRODUTO,
      contract: ATHENA_CONTRACT_VERSION,
      capabilities: ["integrations:health"],
      enabled: athenaIntegrationEnabled(),
      timestamp: new Date().toISOString(),
    },
    requestId,
  );
}
