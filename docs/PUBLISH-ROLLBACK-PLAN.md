# Plano de publicação e rollback — NEXORA CRM (branch de sync)

> **Estado:** DOCUMENTO, não executado. Merge na main e deploy: **só com autorização
> explícita da Cristiane.** Publicação geral: **BLOQUEADA** por ordem dela.

## Sequência exata

### Fase 1 — Staging (pré-requisito de tudo)
1. Staging criado e isolado (ver `docs/STAGING-SETUP.md`; checklist de isolamento OK).
2. Deploy da branch `feat/nexora-sync-deskcomm-77fb59f` no projeto Vercel de staging.
3. Backup do banco de staging (ver `docs/MIGRATION-PLAN.md`).
4. Aplicar migrations NECESSÁRIAS da lista curada em staging.
5. Smoke tests: login, leads, funil, WhatsApp em modo teste, MCP (ferramenta de leitura).
6. `pnpm test:db` contra staging (se Docker disponível).

### Fase 2 — Go / No-Go
| Critério | Go | No-Go |
|---|---|---|
| Build staging | verde | qualquer erro |
| Smoke tests | todos passam | 1 falha funcional |
| Migrations staging | aplicadas sem erro | erro ou divergência |
| Branding | teste 39/39 | qualquer regressão |
| Dados | nenhum dado de produção em staging | vazamento detectado |

**Um único No-Go trava tudo.** Não há "passar com ressalvas".

### Fase 3 — Produção (só após Go total + autorização)
1. Backup de produção verificado (download + restore testado em staging).
2. Janela de manutenção; avisar utilizadores.
3. Aplicar migrations em produção (mesma lista, mesma ordem — ver `docs/MIGRATION-PLAN.md`).
4. Merge da branch na main (fast-forward; sem squash que apague histórico).
5. Deploy em produção (Vercel, a partir da main).
6. Smoke tests em produção + monitorização de erros (Sentry) por 24h.

## Rollback

### Rollback de código (rápido)
Vercel → projeto produção → Deployments → selecionar o deployment anterior estável →
**Promote to Production**. Sem rebuild, sem espera.

### Rollback de base de dados (lento, com downtime)
Só se uma migration corromper dados: restaurar o backup da Fase 3.1.
**Atenção:** writes ocorridos entre a migration e o restore perdem-se — é por isso que
a janela de manutenção existe. Nunca fazer rollback de banco sem a Cristiane saber.

### Ordem de rollback
1. Travar writes (modo manutenção).
2. Promote do deployment anterior (código).
3. Se preciso: restore do backup (banco).
4. Verificar smoke tests; sair do modo manutenção.

## Pós-publicação (24h)
- [ ] Sentry sem novos erros
- [ ] Crons a correr (logs)
- [ ] WhatsApp operacional (mensagem de teste)
- [ ] MCP a responder (1 ferramenta de leitura via Athena)
