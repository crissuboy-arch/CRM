# Staging isolado da produção — NEXORA CRM

> **Estado:** EXECUTADO PARCIALMENTE em 2026-10-20 — projeto Supabase staging criado
> (`aycfntfpbjsdvbfxntzw.supabase.co`) e projeto Vercel `nexora-staging.` criado e a construir
> a branch `feat/nexora-sync-deskcomm-77fb59f`. O primeiro deploy respondeu
> **500 em todas as páginas** — causa diagnosticada e reproduzida (§5): faltam 10 das 13
> variáveis obrigatórias de `lib/env.ts`. O schema do banco staging e o primeiro utilizador
> ainda não foram criados (§6).

## Princípio
Staging = cópia funcional total, **zero partilha** com produção: base de dados, storage,
auth, segredos, crons e provedores WhatsApp separados. Um erro em staging nunca toca produção.

## Passos da Cristiane (consola, ~30 min)

### 1. Novo projeto Supabase (staging)
1. https://supabase.com/dashboard → New project → nome `nexora-crm-staging`
2. Anotar: Project URL, `anon` key, `service_role` key (nunca no chat)
3. **NÃO** ligar backups automáticos de produção a este projeto; **NÃO** reutilizar o projeto de produção

### 2. Novo projeto Vercel (staging) — ou environment Preview
Opção A (recomendada): Vercel → Add New Project → importar `crissuboy-arch/CRM` →
branch `feat/nexora-sync-deskcomm-77fb59f` → nome `nexora-crm-staging`.
Opção B: usar Preview Deployments do projeto de produção (isolamento mais fraco — só se a Opção A for inviável).

### 3. Variáveis de ambiente (staging)
Copiar `.env.example` para `.env.staging.local` (nunca commitar) e preencher **só com
valores de staging**:

| Variável | Staging | Produção |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | URL do projeto staging | URL do projeto produção |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | anon key staging | anon key produção |
| `SUPABASE_SERVICE_ROLE_KEY` | service_role staging | service_role produção |
| `INTERNAL_SECRET` | **novo valor** (`openssl rand -hex 32`) | valor atual (não reutilizar) |
| `INTERNAL_CRON_SECRET` | **novo valor** | valor atual |
| `TENANT_PROVISIONING_SECRET` | vazio (desligado) | conforme produção |
| WhatsApp (WAHA/Meta/Zérnio) | **números de teste** | números reais |
| VoIP/SIP | desligado ou conta de teste | conta real |

Regra: nenhum segredo de produção existe em staging e vice-versa.

#### 3.1 As 13 obrigatórias de `lib/env.ts` (sem elas = 500 em tudo)

`lib/env.ts` valida por Zod no **import** do módulo — e `proxy.ts` (middleware) e
`app/layout.tsx` importam-no, por isso uma obrigatória em falta derruba **todas** as
páginas, incluindo `/login`, com o erro genérico "Internal Server Error". Em produção
(`NODE_ENV=production`) são obrigatórias:

| # | Variável | Origem do valor em staging |
|---|---|---|
| 1 | `NEXT_PUBLIC_SUPABASE_URL` | URL do projeto Supabase staging ✅ configurada |
| 2 | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | anon key do staging ✅ configurada |
| 3 | `SUPABASE_SERVICE_ROLE_KEY` | service_role do staging ✅ configurada |
| 4 | `INTERNAL_SECRET` | **gerar novo** (`openssl rand -hex 32`) |
| 5 | `CPF_ENCRYPTION_KEY` | **gerar novo** (nunca o de produção) |
| 6 | `WAHA_BYO_ENCRYPTION_KEY` | **gerar novo** |
| 7 | `AI_CRED_AES_KEY` | **gerar novo** — 32 bytes em base64 (`openssl rand -base64 32`) |
| 8 | `SUPABASE_DB_URL` | connection string do projeto staging (Supabase → Settings → Database) |
| 9 | `WAHA_API_BASE_URL` | URL de um WAHA de teste (ou placeholder interno enquanto não existir WAHA de staging — o boot só exige não-vazio; o WhatsApp fica inoperante) |
| 10 | `WAHA_API_KEY` | chave do WAHA de teste (idem) |
| 11 | `WAHA_WEBHOOK_BASE_URL` | URL pública deste staging (idem) |
| 12 | `UPSTASH_REDIS_REST_URL` | **criar uma base Redis Upstash só para staging** (plano gratuito) |
| 13 | `UPSTASH_REDIS_REST_TOKEN` | token dessa base |

Depois de as configurar na Vercel (ambiente Production do projeto staging), é preciso
um **redeploy** para as variáveis entrarem em vigor.

### 4. Crons
- Vercel Cron do projeto staging **desligado** até validação manual passar; depois ligado com
  `INTERNAL_CRON_SECRET` de staging.
- Os 20 crons internos do NEXORA usam `INTERNAL_SECRET` — com valor distinto, nunca disparam contra produção.

## Checklist de isolamento (verificar antes do primeiro deploy em staging)
- [ ] `SELECT` numa tabela de staging não devolve dados de produção (comparar 1 registo conhecido)
- [ ] Storage buckets de staging vazios e com nomes distintos
- [ ] Login com utilizador de teste criado em staging; utilizadores de produção inexistentes
- [ ] Webhook/callback URLs apontam para o domínio de staging
- [ ] WhatsApp em modo teste (nenhuma mensagem real enviada — verificar logs do provedor)

## Ficheiro de exemplo
Ver `.env.staging.example` (a criar a partir de `.env.example` com os valores acima).

## Incidente 2026-10-20 — "Internal Server Error" em todas as páginas

**Sintoma:** o deployment `dpl_Dp9hSpAULgchauhwjEq98hVDr8v7` (commit `3eabf3c79`) ficou
READY na Vercel, mas qualquer página — incluindo `/login` — respondia 500.

**Causa raiz (provada por reprodução local):** o projeto Vercel tinha só as 3 variáveis
do Supabase. Em produção, `lib/env.ts` exige 13 (§3.1) e lança
`Error: Variáveis de ambiente inválidas` no import; como `proxy.ts` e `app/layout.tsx`
o importam, **nenhuma** página renderiza. Reprodução determinística:
`tests/unit/env-boot-staging-sem-obrigatorias.test.ts` (2 casos: sem as 10 em falta →
lança nomeando-as uma a uma; com as 13 → importa limpo).

**Não é bug de código:** é o desenho fail-closed do produto (o mesmo que protege o
self-host em VPS). A correção é de **configuração**: completar as 10 variáveis em
falta na Vercel e fazer redeploy. Os logs de runtime da Vercel via MCP devolveram 403
(a ligação MCP não tem permissão de leitura de logs neste projeto) — o diagnóstico
fechou-se por reprodução local, não por leitura dos logs.

## Schema e primeiro utilizador (pendente — exige aprovação)

Com as variáveis completas a app arranca, mas o login ainda precisa de banco real:

1. **Schema:** o projeto Supabase staging nasce vazio. O caminho do produto é aplicar
   `supabase/baseline.sql` (é o que o `install.sh` do self-host aplica; as 523 migrations
   versionadas são o histórico). Aplicação = decisão explícita da Cristiane; nunca
   correr migrations soltas sem aprovação, e **nunca** as destrutivas 0582/0623 sem
   análise própria.
2. **Primeiro utilizador + organização:** criar o utilizador no Supabase Auth do
   staging e a organização inicial pelos fluxos da própria app (signup/onboarding),
   nunca por INSERT manual com service_role sem registo.
3. **Validação:** login real no URL do staging → entra no `/app` → responder ao
   checklist de isolamento acima.
