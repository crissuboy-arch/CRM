# Integração de Banco — Instagram dentro do NEXORA

> Proposta de schema, sem SQL executado. Os nomes finais devem ser conferidos contra a migration mais recente no momento da implementação.

## 1. Princípio

Não criar outro CRM. Dados Instagram devem estender o modelo existente e respeitar a doutrina DIRC: duplicar, integrar, referenciar ou calcular antes de adicionar campo.

Toda tabela tenant-aware nova deve conter `organization_id uuid not null`, FK para `organizations`, RLS, índice por organização e testes de isolamento entre duas organizações. Toda migration deve existir em três lugares: novo arquivo versionado, apêndice idempotente no `supabase/baseline.sql` e linha no `supabase/migrations/MANIFEST.md`.

## 2. Mapeamento de entidades

| OpenReply | NEXORA | Tratamento |
|---|---|---|
| `User/Session/Account` | Supabase Auth | Não migrar |
| `Workspace` | `organizations` | Substituir |
| `WorkspaceMember` | `user_organizations` | Substituir |
| `InstagramAccount` | `channel_sessions` | Estender provider/referência da sessão; detalhes específicos em tabela filha se necessários |
| comentarista/sender | `contacts` | Resolver por identidade externa do canal |
| conversa Instagram | `conversations` | `channel='instagram'`, `channel_session_id`, `provider_conversation_id` |
| mensagem Instagram | `messages` | IDs externos, direction/status/type/metadata |
| `Automation` | `automation_rules` | Traduzir gatilhos/condições/ações |
| `DmLog` | `messages` + runs + delivery ledger | Não manter log paralelo |
| `TrackedLink` | nova tabela estreita ou extensão de tracking existente | Apenas se necessário |
| `LinkClick` | evento de tracking | Vincular campanha/regra, contato/lead quando resolvidos |
| `WebhookEvent` | `webhook_events_log` | Reutilizar |
| `OperationalEvent` | central operacional/Sentry/audit | Reutilizar |
| `FollowerSnapshot` | snapshot opcional | Só se requisito de histórico for aceito |
| `PostbackDelivery` | delivery ledger genérico | Generalizar |

## 3. Alterações em entidades existentes

### 3.1 `channel_sessions`

Adicionar um novo ramo discriminado para Instagram direto, por exemplo `provider='instagram_meta'`. Não reutilizar `meta_cloud`, pois no código atual esse valor significa WhatsApp Cloud.

Campos específicos recomendados:

- `instagram_account_id text` — identificador profissional usado por webhook/messaging;
- `instagram_username text null` — cache de apresentação;
- `instagram_token_encrypted bytea` — cifrado pela infraestrutura canônica;
- `instagram_token_expires_at timestamptz null`;
- `instagram_webhook_subscribed boolean not null default false`.

Alternativa preferível se o check discriminado de `channel_sessions` ficar excessivo: tabela 1:1 `instagram_channel_connections` referenciando `channel_sessions(id)` e `organization_id`. A decisão final deve considerar que `channel_sessions` já acumula colunas de provider. Não guardar token em `metadata`.

Índices/constraints:

- unique parcial global/por regra de negócio para `instagram_account_id` em sessões ativas;
- FK composta organização + sessão quando tabela filha for usada;
- check coerente do ramo do provider;
- índice `(organization_id, provider, archived_at)`.

### 3.2 `conversations`

Reutilizar sem tabela paralela:

- `channel = 'instagram'`;
- `channel_session_id` aponta para a conexão Instagram;
- `provider_conversation_id` recebe o thread/conversation ID quando fornecido;
- `contact_id` aponta para o contato NEXORA;
- estados, atribuição, tags, snooze, IA e unread permanecem canônicos.

Revisar constraints de vocabulário de `channel`, índices unique de conversa 1:1 e queries que presumem identidade WhatsApp.

### 3.3 `messages`

Reutilizar:

- `external_id` = `mid`/message ID Meta;
- `direction` inbound/outbound;
- `type`, `body`, mídia e timestamps canônicos;
- `metadata` apenas para dados eventuais como Story context, media/comment reference e origem; nunca token;
- unique efetivo `(organization_id, external_id)` para IDs não nulos.

Comentários não devem ser forçados a `messages` se não pertencem à thread da Inbox. O evento bruto e a execução da automação fornecem o rastro. Uma resposta privada enviada em razão do comentário, sim, deve gerar mensagem outbound vinculada à conversa criada/resolvida para o destinatário.

### 3.4 `contacts`

Não adicionar `instagram_id` diretamente. Uma pessoa pode ter várias identidades e contas/canais. Usar tabela generalizada de identidade.

### 3.5 `automation_rules`

Reutilizar campos atuais:

- `trigger_event`: `instagram.comment_received`, `message.received`, `instagram.postback_received`;
- `conditions`: media ID, original media ID, keywords, whole-word, match-any-post, account/session;
- `actions`: private reply, public reply, tracked button, follow gate, enroll follow-up, create/move lead, assign agent;
- `automation_rule_runs`: resultado consolidado.

O schema JSON das condições/ações deve ser validado centralmente por Zod. A UI não deve interpretar paths arbitrários sem contrato.

## 4. Novas tabelas realmente necessárias

### 4.1 `contact_channel_identities` — necessária

Resolve identidades externas sem contaminar `contacts` com uma coluna por plataforma.

| Coluna | Tipo/nota |
|---|---|
| `id` | uuid PK |
| `organization_id` | uuid not null |
| `contact_id` | uuid not null |
| `channel_session_id` | uuid not null |
| `provider` | text, vocabulário aberto/controlado em TS conforme doutrina |
| `external_user_id` | text not null, ex. IGSID |
| `username` | text null |
| `display_name` | text null |
| `profile_metadata` | jsonb mínimo e sem segredo |
| `last_seen_at` | timestamptz |
| `created_at`, `updated_at` | timestamptz |

Constraints:

- unique `(organization_id, channel_session_id, external_user_id)`;
- FK composta garantindo que contato e sessão pertençam à mesma organização;
- índice `(organization_id, contact_id)`.

### 4.2 `channel_automation_bindings` — necessária ou configuração tipada equivalente

Vincula uma regra NEXORA a um canal/post sem criar `instagram_automations` paralelo.

| Coluna | Tipo/nota |
|---|---|
| `id` | uuid PK |
| `organization_id` | uuid not null |
| `automation_rule_id` | uuid not null |
| `channel_session_id` | uuid not null |
| `external_media_id` | text null |
| `original_media_id` | text null |
| `bind_next_media` | boolean |
| `created_at`, `updated_at` | timestamptz |

Se todas as consultas forem raras e o motor já indexar adequadamente as regras, esses campos podem permanecer em JSON tipado. Só criar a tabela se o seletor por conta/media for hot path ou exigir FK/unique que JSON não garante.

### 4.3 `channel_delivery_ledger` — necessária

Idempotência durável de side effects externos.

| Coluna | Tipo/nota |
|---|---|
| `id` | uuid PK |
| `organization_id` | uuid not null |
| `channel_session_id` | uuid not null |
| `automation_rule_id` | uuid null |
| `source_event_id` | uuid/text, conforme evento canônico |
| `operation` | private_reply/public_reply/postback/followup |
| `idempotency_key` | text not null |
| `status` | reserved/sending/sent/failed/skipped/uncertain |
| `external_id` | text null |
| `attempts` | smallint |
| `next_attempt_at` | timestamptz null |
| `last_error_code` | text null |
| `last_error_detail` | texto sanitizado |
| `sent_at`, `created_at`, `updated_at` | timestamptz |

Unique `(organization_id, idempotency_key)`. A reserva deve ser transacional antes de qualquer chamada Meta. Estado `uncertain` impede retry cego quando a API pode ter enviado e a confirmação se perdeu.

### 4.4 `tracked_links` e `tracked_link_clicks` — necessárias apenas para tracking interno

Criar se não houver entidade equivalente adequada no snapshot atual.

`tracked_links`: organização, regra/campanha, slug aleatório, label, destination URL validada, UTM/configuração, timestamps.

`tracked_link_clicks`: organização, tracked link, contact/lead nullable, hash rotativo de IP, user-agent truncado, referrer validado, campaign attribution e timestamp.

Não guardar IP bruto. Definir retenção e base legal LGPD. Slug deve ter entropia suficiente e não enumerável.

### 4.5 `channel_metric_snapshots` — opcional

Somente se o histórico de seguidores além da janela da API for requisito aprovado. Chave unique por `(organization_id, channel_session_id, metric, date)` e flag de backfill.

## 5. Tabelas explicitamente não recomendadas

- `instagram_contacts`: duplica `contacts`.
- `instagram_conversations`: duplica `conversations`.
- `instagram_messages`: duplica `messages`.
- `instagram_campaigns`: duplica `automation_rules`/tracking.
- `instagram_automations`: duplica o motor de automação.
- `automation_runs` genérica nova: já existe `automation_rule_runs`.
- `workspaces`: duplica `organizations`.
- tabelas Auth.js/Prisma: duplicam Supabase Auth.

## 6. Eventos canônicos

| Evento | Entidade | Consumidores |
|---|---|---|
| `instagram.webhook_received` | webhook | normalizador/arquivo |
| `instagram.comment_received` | comentário | matcher de automação |
| `instagram.postback_received` | postback | entrega/automação |
| `message.received` | message | Inbox, CRM, follow-up, IA |
| `message.sent` | message | tracking, timeline |
| `instagram.delivery_failed` | ledger | retry/central operacional |
| `instagram.token_refresh_failed` | channel session | health/central |
| `tracked_link.clicked` | click | atribuição/relatório |

Cada evento contém `organization_id`, `channel_session_id`, `source_external_id`, versão do envelope e payload mínimo. PII desnecessária não deve ser replicada no `event_log`.

## 7. Deduplicação

Camadas complementares:

1. webhook bruto: unique por provider/account/event external ID ou hash estável do envelope;
2. entidade: unique `(organization_id, external_id)` nas mensagens;
3. identidade: unique organização/sessão/external user ID;
4. side effect: unique idempotency key no delivery ledger;
5. execução de regra: unique regra + evento, se o motor ainda não garantir;
6. link click: não deduplicar cegamente; aplicar janela analítica configurada, preservando evento legítimo.

IDs sugeridos:

- comment: `ig:comment:{account_id}:{comment_id}:{rule_id}:{operation}`;
- message: `ig:message:{account_id}:{base64url(mid)}:{rule_id}`;
- postback: `ig:postback:{account_id}:{user_id}:{mid|payload_hash}`;
- follow-up: usar enrollment/node/attempt canônicos do NEXORA.

## 8. Migração e compatibilidade

1. alterações apenas aditivas nas primeiras fases;
2. provider novo com backfill nulo para linhas antigas;
3. nenhum valor existente `meta_cloud` é reinterpretado;
4. migrations idempotentes e auto-curativas para clones;
5. atualizar `database.types.ts` somente por geração;
6. RLS com zero vazamento cross-tenant;
7. nenhuma função `public` nova fica executável por `PUBLIC` ou `anon`;
8. rollout com feature flag por organização até hardening final.
