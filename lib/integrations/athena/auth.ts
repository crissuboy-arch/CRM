/**
 * Autenticação das rotas da Athena sobre a auth dual da casa
 * (`lib/api/auth-dual.ts`), com UM refinamento de erro que o contrato
 * promete (§2.2): credencial sem o escopo exigido responde `403
 * forbidden` com `required_scope` no corpo.
 *
 * A decisão de negar é SEMPRE a do `resolveAuthDual` — este wrapper nunca
 * concede nem nega por conta própria. Quando a resolução falha, ele só
 * tenta NOMEAR a razão com prova: relê a credencial apresentada e, se ela
 * for válida mas não tiver o escopo da rota, a falha era de escopo e a
 * resposta passa a dizê-lo. Se a credencial não validar, ou se tiver o
 * escopo (e a falha foi de papel), a resposta original volta intacta —
 * adivinhar a razão seria pior que não a dizer.
 */
import type { NextRequest } from "next/server";

import { resolveAuthDual, type AuthDual } from "@/lib/api/auth-dual";
import { fail } from "@/lib/api/wrappers";
import type { Role } from "@/lib/auth/types";
import { extractBearer, validateBearerToken } from "@/lib/mcp/auth";

export type ResultadoAuthAthena =
  | Extract<AuthDual, { ok: true }>
  | { ok: false; status: number; code: string; requiredScope?: string; response: Response };

/** O código de erro quando o corpo original não o nomeia: deriva do status. */
function codigoPorStatus(status: number): string {
  if (status === 401) return "unauthorized";
  if (status === 403) return "forbidden";
  if (status === 429) return "rate_limited";
  return "internal_error";
}

/** O `error.code` do corpo de uma resposta de erro, ou `null` se ilegível. */
async function codigoDoCorpo(response: Response): Promise<string | null> {
  try {
    const corpo: unknown = await response.clone().json();
    if (corpo !== null && typeof corpo === "object") {
      const erro = (corpo as { error?: unknown }).error;
      if (erro !== null && typeof erro === "object") {
        const code = (erro as { code?: unknown }).code;
        return typeof code === "string" && code !== "" ? code : null;
      }
    }
    return null;
  } catch {
    return null;
  }
}

export async function autenticarAthena(
  req: NextRequest,
  opts: { requestId: string; resource: string; role: Role; scope: string },
): Promise<ResultadoAuthAthena> {
  const authz = await resolveAuthDual(req, opts);
  if (authz.ok) return authz;

  const status = authz.response.status;
  const code = (await codigoDoCorpo(authz.response)) ?? codigoPorStatus(status);
  const original: ResultadoAuthAthena = { ok: false, status, code, response: authz.response };

  // O refinamento só se aplica a um 403 com Bearer: é o único caso em que
  // "sem o escopo" e "papel insuficiente" se confundem na resposta da casa.
  if (status !== 403) return original;
  const authHeader = req.headers.get("authorization");
  if (!extractBearer(authHeader)) return original;

  let scopes: string[];
  try {
    const validado = await validateBearerToken(authHeader);
    scopes = validado.scopes;
  } catch {
    // A credencial não valida (revogada, expirada, inexistente): a razão
    // não é escopo, e a resposta original já é a verdade que há.
    return original;
  }
  if (scopes.includes(opts.scope)) {
    // Tem o escopo: a falha foi de papel. Resposta original intacta.
    return original;
  }
  return {
    ok: false,
    status: 403,
    code: "forbidden",
    requiredScope: opts.scope,
    response: fail("forbidden", `Token sem o escopo exigido '${opts.scope}'.`, 403, {
      requestId: opts.requestId,
      details: { required_scope: opts.scope },
    }),
  };
}
