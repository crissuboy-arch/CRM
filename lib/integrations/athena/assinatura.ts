/**
 * Assinatura HMAC dos webhooks de entrada da Athena.
 *
 * O remetente assina o corpo CRU com HMAC-SHA256 e o segredo partilhado
 * (`ATHENA_WEBHOOK_SECRET`), em hex, no cabeçalho `x-athena-signature`
 * (com ou sem o prefixo `sha256=`). A comparação usa
 * `timingSafeStringEqual` — a mesma régua dos segredos de cron: os dois
 * lados são hasheados antes de comparar, por isso nem o comprimento do
 * segredo vaza pelo tempo de resposta.
 *
 * Fail-closed em todos os ramos: sem cabeçalho, sem segredo ou assinatura
 * errada é sempre `false`. Não há modo "aceita sem assinar": onde o
 * remetente pode assinar — e a Athena pode —, a assinatura é obrigatória.
 */
import { createHmac } from "node:crypto";

import { timingSafeStringEqual } from "@/lib/auth/cron-auth";

export const ATHENA_SIGNATURE_HEADER = "x-athena-signature";

/** A assinatura esperada para um corpo — exposta para quem assina e testa. */
export function assinaturaAthena(rawBody: string, secret: string): string {
  return createHmac("sha256", secret).update(rawBody).digest("hex");
}

export function assinaturaAthenaValida(
  rawBody: string,
  header: string | null,
  secret: string,
): boolean {
  if (!header || !secret) return false;
  const provided = header.startsWith("sha256=") ? header.slice("sha256=".length) : header;
  if (!provided) return false;
  return timingSafeStringEqual(provided.toLowerCase(), assinaturaAthena(rawBody, secret));
}
