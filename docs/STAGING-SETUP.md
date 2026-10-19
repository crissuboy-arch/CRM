# Staging isolado da produção — NEXORA CRM

> **Estado:** PREPARADO, não executado. A criação de recursos (projeto Supabase, projeto Vercel)
> exige ações na consola e é passo da Cristiane. Nada aqui cria, altera ou custa nada.

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
