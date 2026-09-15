# PHASE 1 — Handoff de encerramento

Data: 2026-09-15. Produto único: NEXORA CRM.
Repositório: https://github.com/crissuboy-arch/CRM.git
Branch de integração: `feat/instagram-foundation`.

## Estado preservado

PHASE 1 salva como checkpoint incompleto; não aprovada para deploy. Não foi implementada nenhuma funcionalidade da PHASE 2 nesta execução. Não executar OAuth, conexão, webhooks, transporte ou novas telas antes de concluir os gates pendentes.

Base: PHASE 0 `b162cce84bb6e806f7052fd8a949747ea6331663`; documentação oficial `0fe19696`. Os seis documentos Work, ADR-001 a ADR-010 e THIRD_PARTY_NOTICES.md permanecem intactos. O roadmap oficial continua sendo a referência; este arquivo registra somente o estado de entrega.

Trabalho encontrado no worktree `NEXORA-phase-1`, branch de trabalho `feat/instagram-phase-1`, sobre `0fe19696`. O checkout original `DeskcommCRM`, branch `feat/instagram-channel-foundation`, contém alterações independentes de `components/auth/LoginForm.tsx` e `proxy.ts`: preservadas sem inclusão neste commit.

## Implementado no checkpoint

- Provider `instagram_meta`, capabilities conservadoras e referência `instagram_account_id`; providers existentes preservados.
- Disponibilidade desligada e adapter Instagram ausente: transporte recusado explicitamente; sem conexão real.
- Fonte de templates Instagram nula e inclusão do provider na cerca do lint de canais.
- Variáveis opcionais declaradas sem credenciais; não habilitam integração.
- Migration `20260914010000_0231_instagram_channel_foundation.sql`: vocabulário/constraints, referência de sessão, identidade multicanal `contact_channel_identities`, FKs compostas por organização, unicidade, políticas de leitura e privilégios, guards de associação e anonimização via trigger/RPC.
- Baseline: apêndice 0231 antes da varredura final de permissões; substituição do trecho antigo que reconstruía CHECKs de somente três providers por reconstrução no apêndice. Migration histórica 0131 não alterada.
- MANIFEST: entrada da migration 0231.
- Tipos: adições em `lib/database.types.ts` para referência Instagram e identidades; script `scripts/update-channel-foundation-types.mjs` para incorporar introspecção oficial das tabelas envolvidas. A geração/validação final contra banco ainda deve ser comprovada.

## Arquivos desta entrega

- `.env.example` (somente template, nomes comentados sem valores)
- `lib/channels/availability.ts`
- `lib/channels/capabilities.ts`
- `lib/channels/index.ts`
- `lib/channels/session-ref.ts`
- `lib/channels/templates-fonte.ts`
- `lib/channels/types.ts`
- `lib/database.types.ts`
- `lib/env.ts`
- `scripts/lint-channels.pattern.ts`
- `scripts/update-channel-foundation-types.mjs`
- `supabase/baseline.sql`
- `supabase/migrations/MANIFEST.md`
- `supabase/migrations/20260914010000_0231_instagram_channel_foundation.sql`
- `tests/unit/channel-capability-matrix.test.ts`
- `tests/unit/instagram-channel-foundation.test.ts`
- `tests/invariants/instagram-channel-foundation.test.ts`
- `docs/architecture/INSTAGRAM-PHASE-1-DELIVERY.md`
- `docs/architecture/PHASE-1-HANDOFF.md`

## Checks já relatados

Segundo o registro fornecido pelo usuário: 15 testes focados passaram; lint focado de canais passou; typecheck passou após correções. Não foram repetidos no encerramento. Não há certificação de que esses resultados cubram cada edição posterior do snapshot atual. A seção de aceite do DELIVERY descreve checks desejados, não resultados executados.

## Pendências e bloqueadores

Docker/WSL indisponível na execução anterior. Não foi tentado iniciar ou reparar Docker neste encerramento.

- Prova real de RLS e privilégios em banco.
- Validação cross-tenant das identidades e conversas; associações contato/sessão/provider e anonimização.
- Aplicação e reaplicação idempotente do baseline com dados existentes, incluindo Instagram; instalação fresca e upgrade.
- Regeneração/comparação final dos tipos com introspecção do schema validado.
- Bloqueador textual observado na leitura curta: a definição de `fn_lgpd_cascade_redact_contact` na migration 0231 contém delimitador `AS $` em vez de dollar-quote PostgreSQL válido. Conferir e corrigir os delimitadores correspondentes na migration e no apêndice do baseline antes de aplicar SQL. Nenhuma correção de implementação foi feita neste encerramento; o estado original foi preservado.

Nenhum banco remoto foi alterado, nenhum teste foi reexecutado, nenhuma arquitetura foi reescrita e nenhuma implementação adicional foi iniciada. Não fazer merge em main com base neste checkpoint.

**PRÓXIMA AÇÃO: Concluir somente as validações pendentes da PHASE 1 em ambiente com Docker/banco disponível antes de iniciar PHASE 2.** Começar pelo bloqueador de delimitadores SQL identificado acima, sincronizar migration/baseline e então executar as provas de banco e tipos pendentes.
