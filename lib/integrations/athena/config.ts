/**
 * Configuração da integração Athena — DESLIGADA por omissão.
 *
 * O contrato oficial está em `ATHENA_NEXORA_INTEGRATION_CONTRACT.md`
 * (proposta v1). Aqui mora só a leitura do ambiente e as constantes do
 * contrato, num sítio só, para as rotas não espalharem `env.*` nem
 * decidirem cada uma o que "ligado" quer dizer.
 *
 * A credencial de serviço NÃO é uma variável de ambiente: é um token
 * `dsk_...` de `api_tokens`, por organização, com os escopos `athena:*`
 * abaixo — o mesmo mecanismo que o MCP usa (`lib/mcp/auth.ts`), porque é
 * ele que resolve `organization_id` de uma fonte confiável (a linha do
 * token), coisa que um segredo global jamais poderia fazer sem aceitar a
 * organização do corpo do pedido, que a doutrina proíbe.
 *
 * Não há segredo de webhook: pela decisão arquitetural do contrato, a
 * Athena NÃO envia webhooks a produtos — ela consome as APIs HTTPS do
 * NEXORA via Athena Control. A antiga porta de webhook HMAC foi abolida.
 */
import { env } from "@/lib/env";
import pkg from "@/package.json";

/** Versão do contrato de integração que esta implementação cumpre. */
export const ATHENA_CONTRACT_VERSION = "v1";

/** Escopo que dá acesso a `GET /stats` (agregados da organização). */
export const ATHENA_SCOPE_STATS = "athena:stats";

/** Escopo que dá acesso a `GET /capabilities` (catálogo e configuração resumida). */
export const ATHENA_SCOPE_CAPABILITIES = "athena:capabilities";

/** Escopo que dá acesso a pedir ações e a consultar os seus pedidos e a evidência. */
export const ATHENA_SCOPE_ACTIONS = "athena:actions";

/**
 * A versão do produto que o *health* anuncia. Vem do `package.json` — a
 * fonte única da versão da instalação — para o health nunca anunciar um
 * número que uma edição manual esqueceu de acompanhar.
 */
export const ATHENA_VERSAO_DO_PRODUTO: string = pkg.version;

/**
 * A integração só está ligada com o valor exato `true`. Qualquer outra
 * coisa — vazio, `1`, `True`, erro de digitação — é DESLIGADO, e as rotas
 * autenticadas respondem 404: feature que nasce desligada não pode nascer
 * meio-ligada por um typo do operador.
 */
export function athenaIntegrationEnabled(): boolean {
  return env.ATHENA_INTEGRATION_ENABLED === "true";
}
