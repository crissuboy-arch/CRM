/**
 * Configuração da integração Athena — preparação, DESLIGADA por omissão.
 *
 * O contrato inteiro está em `docs/integracao/athena.md`. Aqui mora só a
 * leitura do ambiente, num sítio só, para as rotas não espalharem `env.*`
 * nem decidirem cada uma o que "ligado" quer dizer.
 *
 * A credencial de serviço NÃO é uma variável de ambiente: é um token
 * `dsk_...` de `api_tokens`, por organização, com o escopo
 * `athena:commands` — o mesmo mecanismo que o MCP usa (`lib/mcp/auth.ts`),
 * porque é ele que resolve `organization_id` de uma fonte confiável (a
 * linha do token), coisa que um segredo global jamais poderia fazer sem
 * aceitar a organização do corpo do pedido, que a doutrina proíbe.
 */
import { env } from "@/lib/env";

/** Escopo exigido ao token de serviço da Athena (`api_tokens.scopes`). */
export const ATHENA_SCOPE = "athena:commands";

/** Comprimento mínimo do segredo HMAC — a mesma régua de `tenants/provision`. */
export const ATHENA_WEBHOOK_SECRET_MIN = 32;

/**
 * A integração só está ligada com o valor exato `true`. Qualquer outra
 * coisa — vazio, `1`, `True`, erro de digitação — é DESLIGADO, e as rotas
 * respondem 404: feature que nasce desligada não pode nascer meio-ligada
 * por um typo do operador.
 */
export function athenaIntegrationEnabled(): boolean {
  return env.ATHENA_INTEGRATION_ENABLED === "true";
}

/**
 * O segredo HMAC dos webhooks de entrada, ou `""` quando não há segredo
 * utilizável (ausente ou curto demais). Quem chama trata `""` como
 * "webhook desligado" — fail-closed, nunca "aceita sem assinar".
 */
export function athenaWebhookSecret(): string {
  const secret = env.ATHENA_WEBHOOK_SECRET;
  return secret.trim().length >= ATHENA_WEBHOOK_SECRET_MIN ? secret : "";
}
