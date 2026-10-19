# Plano seguro de migrations — NEXORA CRM

> **Estado:** PREPARADO, não executado. Nenhuma migration foi aplicada em nenhum ambiente.
> Produção: **PROIBIDO sem autorização explícita da Cristiane.**

## Factos de partida (CONFIRMADOS no repo)
- Migrations versionadas em `supabase/migrations/` (524 ficheiros após o sync; 311 novos do upstream).
- `supabase/baseline.sql` é o que o self-host (`install.sh`/`update.sh`) aplica.
- Doutrina da casa: mudança de schema = tripla (migration com `-- manifest:` + apêndice
  idempotente no `baseline.sql`); **nunca editar migration já aplicada**.
- `pnpm db:migrate` é um stub TODO — **não existe runner automático ligado**. Aplicação é
  manual (Supabase CLI ou SQL Editor), ficheiro a ficheiro, por ordem.
- Lista curada do que é realmente necessário:
  `~/workspace/research_notes/nexora-athena-auditoria/migrations-curadas.md`
  (categorias: necessárias / redundantes / a verificar em staging).

## Procedimento (staging primeiro, sempre)

### 1. Backup (antes de tudo)
- Supabase Dashboard → projeto **staging** → Database → Backups → Download, **ou**
  `pg_dump` via connection string do projeto staging.
- Guardar o dump com data/hora. Sem backup verificado, não aplicar nada.

### 2. Ordem de aplicação
1. Aplicar **só** as marcadas NECESSÁRIAS na lista curada, pela ordem de timestamp/nome.
2. As marcadas A VERIFICAR EM STAGING decidem-se com o banco à frente (ver §4).
3. As REDUNDANTES não se aplicam.

### 3. Como aplicar (sem runner automático)
```bash
# via Supabase CLI, do repo, apontado ao projeto STAGING:
supabase db push --db-url "$STAGING_DB_URL"   # revê o diff antes de confirmar
# ou: SQL Editor do dashboard staging, colando cada ficheiro por ordem
```
Após cada lote de ~20 migrations: correr checks do §4.

### 4. Verificação após aplicar
- `pnpm test:db` (invariantes RLS/isolamento — precisa de Docker; em staging pode correr
  contra o banco de staging).
- Comparar `\dt` / contagem de tabelas antes/depois com o esperado da lista curada.
- Smoke: login, criação de lead, movimentação no funil.

### 5. Rollback
- **Não existem down-migrations.** Rollback = restaurar o backup do passo 1.
- Para migrations individuais problemáticas: escrever migration corretiva nova
  (doutrina: nunca editar a aplicada), nunca `DROP` manual sem revisão.

## Para produção (quando a Cristiane autorizar)
1. Backup de produção verificado (download + restore testado em staging).
2. Janela de manutenção comunicada; app em modo manutenção se houver writes concorrentes.
3. Aplicar a mesma lista curada, na mesma ordem, com os mesmos checks.
4. Qualquer falha → parar, restaurar backup, reportar. Nunca "forçar passagem".

## Riscos conhecidos
- 2 migrations destrutivas identificadas no sync (`drop table crm_calls` com cópia prévia,
  `drop column ai_budget_cents` sem leitores) — veredito detalhado na lista curada.
- Divergência NEXORA/upstream: o NEXORA pode já ter objetos com outro nome — é por isso que
  a categoria A VERIFICAR EM STAGING existe.
