/**
 * As respostas PLANAS da integração Athena.
 *
 * *Health*, *stats* e *capabilities* respondem JSON plano, sem o envelope
 * `{ data, … }` da API versionada: é o formato que a Athena Control já
 * consome de outros produtos (precedente VitrinePro) e o que o contrato
 * manda (§3). As rotas de ações usam o envelope da casa (`ok()`/`fail()`);
 * estas três, não — misturar os dois formatos na mesma rota faria a
 * Control precisar de um caso especial por produto.
 *
 * Todas levam `X-Request-Id` (correlação com a auditoria) e
 * `Cache-Control: no-store`: são respostas com dados da organização ou
 * sobre o estado dela, e nenhuma cache entre o NEXORA e a Athena pode
 * guardar uma fotografia velha delas.
 */
import { NextResponse } from "next/server";

export function respostaPlana(corpo: unknown, requestId: string, status = 200): NextResponse {
  const res = NextResponse.json(corpo, { status });
  res.headers.set("X-Request-Id", requestId);
  res.headers.set("Cache-Control", "no-store");
  return res;
}

/**
 * O erro das rotas planas: `{ error: "<code>", … }` — o código vai como
 * valor de `error`, não dentro de um objeto, que é como os precedentes
 * respondem e como a Control lê. Campos extra (ex.: `required_scope`)
 * entram ao mesmo nível via `extra`.
 */
export function erroPlano(
  code: string,
  status: number,
  requestId: string,
  extra?: Record<string, unknown>,
): NextResponse {
  const res = NextResponse.json({ error: code, ...extra }, { status });
  res.headers.set("X-Request-Id", requestId);
  res.headers.set("Cache-Control", "no-store");
  return res;
}
