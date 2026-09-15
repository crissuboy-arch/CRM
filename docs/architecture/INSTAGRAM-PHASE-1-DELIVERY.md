# PHASE 1 — Channel foundation

Escopo autorizado: documentos aprovados em `0fe19696`. Base remota conferida por
`git fetch origin`: `origin/main` em `6aee6564`, sem divergência em canais ou
migrations contra o snapshot. Trabalho isolado em `feat/instagram-phase-1`,
worktree `NEXORA-phase-1`, preservando as alterações locais de login.

## Contratos implementados

- `lib/channels/types.ts`, `capabilities.ts`, `session-ref.ts`: novo discriminante
  `instagram_meta` e referência `instagram_account_id`. `meta_cloud` permanece
  WhatsApp Cloud. Descritor conservador sem grupos, templates ou envio fora da
  janela; sem transporte disponível, os limites operacionais serão medidos nas
  fases de envio, sem importar limites do WhatsApp.
- `availability.ts` e `index.ts`: flag constante desligada e resolução de adapter
  bloqueada. Não existe endpoint de conexão, credencial, webhook, envio ou item
  novo na navegação. `runtime.ts` já delega ao handler que usa esse registry;
  nenhuma alteração no runtime ou registry de navegação é necessária nesta fase.
- `templates-fonte.ts`: Instagram não resolve rotas de templates WhatsApp.
  `scripts/lint-channels.pattern.ts`: o novo provider entra na cerca existente.
  Schemas REST de mensagens já recebem IDs de conversa; não exigem novo campo
  público de provider para reconhecer a foundation.
- `0231`: coluna de referência, vocabulário de conversa, unicidade de conta ativa
  por organização e tabela `contact_channel_identities`. FKs compostas vinculam
  identidade a contato e sessão/provider na mesma organização. O ID externo é
  único por organização/sessão; IDs iguais em tenants distintos são permitidos.
- RLS: membros ativos leem somente seu tenant; `authenticated` não escreve e
  `anon` não acessa. A escrita fica na service role para a ingestão futura.
- Contato anonimizado ou mesclado não recebe nova identidade; anonimização
  remove as identidades via trigger e RPC canônica, com contagem na RPC.
  Conversas Instagram exigem sessão Instagram e contato
  da mesma organização, sem grupos.
- `lib/env.ts` e `.env.example`: somente nomes opcionais de configuração futura,
  sem valores, sem `NEXT_PUBLIC_*` e sem habilitação implícita.
- Baseline: constraints de provider reconstruídas somente no apêndice final
  `0231`, antes da varredura de permissões; migration histórica `0131` intacta.

## Limite da entrega

OAuth, tabela de credenciais e nonce pertencem à PHASE 2. Ledger de entrega,
parsers, Inbox, automações, tracking e IA permanecem nas fases aprovadas. Nenhum
código do OpenReply foi portado; avisos de licença existentes preservados.

## Sistema vivo e rollback

Arestas desta foundation: `channel_sessions → contact_channel_identities → contacts`;
`channel_sessions → resolveSessionRef → registry` (bloqueado para Instagram).
A falha de escopo ou duplicação é recusada pela constraint/trigger, sem criar
associação parcial; anonimização elimina a identidade. Não há demanda, evento
ou envio novo sem consumidor. UI, audit de conexão, alertas e continuidade IA/humano
entram somente quando as respectivas fases habilitarem operações reais.

Rollback de aplicação: voltar ao commit anterior mantendo a flag desligada.
Schema aditivo pode permanecer; não apagar identidades nem reintroduzir CHECK
antigo que recuse linhas Instagram. Não há backfill de contatos ou transformação
dos dados WhatsApp. A reaplicação do baseline deve ser testada com dados novos.

## Aceite executável

- `pnpm typecheck`, `pnpm lint`, `pnpm lint:channels`, `pnpm test:unit`.
- `pnpm test:db`: install/update e invariantes reais; o novo arquivo
  `tests/invariants/instagram-channel-foundation.test.ts` cobre duas organizações,
  RLS, privilégios, FKs, duplicação, vocabulário e anonimização.
- Tipos regenerados a partir do schema; não editados manualmente.
- Nenhuma evidência visual nova é exigida: não há alteração de tela nesta fase.

Resultados da execução serão registrados ao finalizar a validação.
PHASE 2 exige nova autorização e não faz parte desta execução.
