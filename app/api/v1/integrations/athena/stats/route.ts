/**
 * GET /api/v1/integrations/athena/stats — agregados da organização da
 * credencial, em JSON PLANO (o formato que a Athena Control já consome).
 *
 * Só contagens e totais — nenhum registo individual de cliente, conversa ou
 * lead sai por aqui (contrato §1.5). A organização vem da credencial
 * resolvida por `autenticarAthena`, nunca do pedido. Desligada, a rota
 * responde 404 plano, como se não existisse; só o health responde sempre.
 *
 * Por credencial (token) aplica-se o limite de 60 pedidos/min — o precedente
 * da VitrinePro neste mesmo padrão. Pela sessão não há contagem: quem
 * consulta é uma pessoa.
 *
 * Contrato: `docs/integracao/athena.md` (§3.2).
 */
import { randomUUID } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";

import { checkRateLimit } from "@/lib/ai/dispatcher/rate-limit";
import { autenticarAthena } from "@/lib/integrations/athena/auth";
import { ATHENA_SCOPE_STATS, athenaIntegrationEnabled } from "@/lib/integrations/athena/config";
import { estatisticasDaOrganizacao } from "@/lib/integrations/athena/estatisticas";
import { erroPlano, respostaPlana } from "@/lib/integrations/athena/respostas";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();

  if (!athenaIntegrationEnabled()) {
    return erroPlano("not_found", 404, requestId);
  }

  const auth = await autenticarAthena(req, {
    requestId,
    resource: "athena_stats",
    role: "viewer",
    scope: ATHENA_SCOPE_STATS,
  });
  if (!auth.ok) {
    return erroPlano(
      auth.code,
      auth.status,
      requestId,
      auth.requiredScope ? { required_scope: auth.requiredScope } : undefined,
    );
  }

  // O limite é por credencial: sem token não há balde que faça sentido
  // contar (a sessão é de uma pessoa, não de uma integração em laço).
  if (auth.via === "token") {
    const limite = await checkRateLimit(`athena_stats:tok:${auth.apiTokenId}`, 60, 60);
    if (!limite.allowed) {
      // `erroPlano` não aceita headers extra — e o 429 PRECISA do
      // `Retry-After` para a Athena fazer backoff em vez de insistir.
      // Monta-se a resposta à mão, com os mesmos cabeçalhos das planas.
      const res = NextResponse.json({ error: "rate_limited" }, { status: 429 });
      res.headers.set("X-Request-Id", requestId);
      res.headers.set("Cache-Control", "no-store");
      res.headers.set("Retry-After", "60");
      return res;
    }
  }

  try {
    const stats = await estatisticasDaOrganizacao(auth.supabase, auth.organizationId);
    // Um único instante para os dois carimbos: `generated_at` e `timestamp`
    // descrevem o mesmo momento e não podem divergir nem por milissegundos.
    const ts = new Date().toISOString();
    return respostaPlana(
      {
        platform: "NEXORA CRM",
        contract: "v1",
        ...stats,
        generated_at: ts,
        timestamp: ts,
      },
      requestId,
    );
  } catch {
    return erroPlano("internal_error", 500, requestId);
  }
}
