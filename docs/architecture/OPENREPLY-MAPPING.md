# OpenReply → NEXORA — Matriz de Equivalência

> Classificações: **REUTILIZAR** = portar lógica madura; **ADAPTAR** = preservar comportamento, trocar integração/contratos; **SUBSTITUIR PELO NEXORA** = usar módulo já existente; **DESCARTAR** = não entra no produto.

## 1. Plataforma e infraestrutura

| OpenReply | Decisão | Destino NEXORA | Motivo |
|---|---|---|---|
| Next.js App Router | SUBSTITUIR PELO NEXORA | app NEXORA | Ambos usam Next 16; o NEXORA é a aplicação principal. |
| React/Tailwind | SUBSTITUIR PELO NEXORA | design system NEXORA | Evita duas interfaces e tokens visuais. |
| Auth.js/NextAuth | DESCARTAR | Supabase Auth | NEXORA já tem autenticação, MFA, recuperação e sessão. |
| Prisma Client/Adapter | DESCARTAR | Supabase clients + SQL | Um segundo ORM/schema criaria duas fontes de verdade. |
| `User`, `Account`, `Session`, `VerificationToken` | DESCARTAR | Supabase Auth | Entidades pertencem ao Auth.js. |
| `Workspace`, membros e convites | SUBSTITUIR PELO NEXORA | `organizations`, `user_organizations` | Tenant/RBAC NEXORA é canônico e mais granular. |
| BullMQ queue | DESCARTAR | `event_log`, `job_queue`, workers | NEXORA já possui barramento e operação self-host. |
| ioredis TCP | DESCARTAR como dependência | Upstash/ledger NEXORA | Só era obrigatório pelo BullMQ. |
| Docker Postgres próprio | DESCARTAR | Supabase/Postgres NEXORA | Um banco único. |
| worker `dm-worker.ts` | ADAPTAR | handlers/workers NEXORA | Portar máquinas de estado e side effects; não o bootstrap BullMQ. |
| cron/token refresh | ADAPTAR | scheduler/cron NEXORA | Preservar comportamento e alertas operacionais. |

## 2. Instagram e Meta

| OpenReply | Decisão | Destino NEXORA | Motivo |
|---|---|---|---|
| `lib/meta/oauth.ts` | ADAPTAR | `lib/channels/instagram/oauth-*` | Reutilizar protocolo; trocar state stateless por nonce persistente e Supabase tenant. |
| AES-256-GCM local | SUBSTITUIR PELO NEXORA | `fn_encrypt_oauth`/`fn_decrypt_oauth` | Não criar terceira infraestrutura criptográfica. |
| Instagram Login scopes | REUTILIZAR | cliente OAuth NEXORA | Capacidades necessárias: basic, messages, comments, insights. Revalidar versões/permissões no momento da implementação. |
| exchange e long-lived token | REUTILIZAR/ADAPTAR | cliente Meta NEXORA | Lógica madura, mas logs/erros/env seguem padrões NEXORA. |
| refresh de tokens | ADAPTAR | cron + central operacional | Falha deve aparecer na operação NEXORA. |
| subscription webhook por conta | REUTILIZAR/ADAPTAR | serviço de conexão | Registrar estado na sessão e reconciliar assinaturas. |
| `lib/meta/webhook.ts` | REUTILIZAR/ADAPTAR | parser puro Instagram | Preservar parsing, adicionar Zod/contrato e envelope NEXORA. |
| verificação `x-hub-signature-256` | REUTILIZAR/ADAPTAR | rota webhook NEXORA | HMAC/timing-safe, fail-closed, sem body preview com PII. |
| Meta read content/posts | REUTILIZAR/ADAPTAR | seletor de conteúdo NEXORA | Necessário para campanhas por post/reel. |
| Meta read inbox | ADAPTAR | sincronização para Inbox NEXORA | A UI OpenReply é descartada; dados devem ser normalizados. |
| Meta send messages/comments | REUTILIZAR/ADAPTAR | Instagram channel adapter | Adapter só traduz; regras ficam no before-send/automação. |
| Zernio OpenReply | DESCARTAR inicialmente | provider NEXORA já existente | NEXORA já tem adapter Zernio com contratos próprios; avaliar suporte Instagram separadamente, sem copiar integração. |

## 3. Contatos, Inbox e CRM

| OpenReply | Decisão | Destino NEXORA | Motivo |
|---|---|---|---|
| `InstagramAccount` | ADAPTAR | `channel_sessions` + detalhes Instagram | Conexão é canal da organização; não entidade de app paralela. |
| Inbox page/components | DESCARTAR | Inbox NEXORA | O NEXORA já tem Inbox de 3 painéis, atribuição, tags, notas, mídia e Realtime. |
| lista de conversas Meta | ADAPTAR | `conversations` | Persistir e consultar modelo canônico. |
| mensagens Instagram | ADAPTAR | `messages` | Preservar external ID, direction, timestamps e status. |
| participante/comentarista | ADAPTAR | `contacts` + identidade de canal | Não criar `instagram_contacts`. |
| DM logs | SUBSTITUIR PELO NEXORA | `messages`, runs, event/audit logs | Resultado do envio pertence à mensagem e à execução da automação. |
| nenhum CRM do OpenReply | SUBSTITUIR PELO NEXORA | `crm_*` | O NEXORA transforma a interação em lead/funil. |
| follower snapshots | ADAPTAR/opcional | tabela de métricas de canal | Não misturar com contato; usar apenas se o dashboard exigir histórico. |

## 4. Automação e campanhas

| OpenReply | Decisão | Destino NEXORA | Motivo |
|---|---|---|---|
| `Automation` | ADAPTAR | `automation_rules` + configuração tipada | Não criar segundo motor; converter trigger/conditions/actions. |
| keyword matcher | REUTILIZAR | condição de automação | Boa lógica Unicode/whole-word e testes existentes. |
| post/reel targeting | REUTILIZAR/ADAPTAR | condição `instagram.media_id` | Inclui `original_media_id` de anúncio impulsionado. |
| match any post | REUTILIZAR | condição de regra | Configuração simples no motor atual. |
| pending next reel | ADAPTAR | binding de conteúdo/campanha | Precisa de job de anexação e estado explícito. |
| comment → private reply | REUTILIZAR/ADAPTAR | ação Instagram | Capacidade principal. |
| resposta pública | REUTILIZAR/ADAPTAR | ação independente | Resultado/idempotência separados da DM. |
| opening DM + button | REUTILIZAR/ADAPTAR | sequência de ações | Preservar postback e fallback de leitura. |
| follow gate | REUTILIZAR/ADAPTAR | condição/ação Instagram | Falha aberta é decisão de produto que deve ficar explícita. |
| DM keyword trigger | REUTILIZAR/ADAPTAR | trigger `message.received` | Usa mensagem canônica do NEXORA. |
| Story reply trigger | ADAPTAR | DM inbound + contexto | Story replies chegam como mensagens; não criar motor separado. |
| follow-up simples | SUBSTITUIR PELO NEXORA | `followup_flow_*` | NEXORA já tem grafo, versionamento e enrollments. |
| campaign CRUD/UI | ADAPTAR | UX NEXORA sobre regras | Reutilizar semântica, não componentes visuais. |
| templates de campanha | ADAPTAR | templates NEXORA | Importar conteúdo/configuração com atribuição. |
| CSV import | ADAPTAR/opcional | importador NEXORA | Só depois do modelo final de regra estar estável. |
| duplicate campaign | ADAPTAR | duplicação transacional NEXORA | Novo IDs/slugs, começa pausada, sem métricas herdadas. |

## 5. Tracking e relatórios

| OpenReply | Decisão | Destino NEXORA | Motivo |
|---|---|---|---|
| `TrackedLink` | ADAPTAR | links/atribuição NEXORA | Pode exigir tabela específica, mas vinculada à regra/campanha e ao lead. |
| `LinkClick` | ADAPTAR | eventos de tracking | Hash de IP, retenção e LGPD NEXORA. |
| redirect `/r/[slug]` | REUTILIZAR/ADAPTAR | rota pública NEXORA | Validar destino e evitar open redirect/SSRF. |
| CTR/report data | ADAPTAR | métricas NEXORA | Agregar runs, sends, clicks e leads. |
| public shared report | DESCARTAR inicialmente | relatórios autenticados NEXORA | Aumenta superfície pública; só reintroduzir com requisito explícito. |
| Meta Ads handling de `original_media_id` | REUTILIZAR | atribuição | Evita perder comentários de posts impulsionados. |

## 6. Resiliência e operação

| OpenReply | Decisão | Destino NEXORA | Motivo |
|---|---|---|---|
| deterministic job IDs | REUTILIZAR/ADAPTAR | idempotency keys persistentes | Excelente princípio; não depender da retenção da fila. |
| unique automation/comment | ADAPTAR | delivery ledger | Separar por regra, evento e tipo de ação. |
| `PostbackDelivery` | ADAPTAR | delivery ledger genérico | Um ledger serve postback, DM, public reply e follow-up. |
| 3 attempts/custom backoff | ADAPTAR | política de retry NEXORA | Classificar erro transitório/permanente e usar `next_attempt_at`. |
| rate limit Lua Redis | REUTILIZAR conceitualmente | limiter NEXORA | Reserva atômica por conta/operação; limite configurável. |
| comment reconciler | REUTILIZAR/ADAPTAR | cron cursorado | Recuperação limitada; não polling amplo. |
| webhook event log | SUBSTITUIR PELO NEXORA | `webhook_events_log` | NEXORA já arquiva payload, assinatura, status e attempts. |
| operational events | SUBSTITUIR PELO NEXORA | central/Sentry/audit | Uma única operação visível. |
| usage/billing counters | DESCARTAR no MVP | políticas NEXORA | OpenReply não impõe plano; NEXORA self-host não precisa duplicar contador. |

## 7. UI detalhada

| Componente OpenReply | Decisão | Uso futuro |
|---|---|---|
| `dashboard-shell`, sidebar, top bar | DESCARTAR | NEXORA AppShell/NavHub/Sidebar |
| Inbox page | DESCARTAR | ampliar filtros do Inbox NEXORA por canal |
| `campaign-builder` | ADAPTAR | reconstruir com componentes NEXORA e schema de regra NEXORA |
| `keyword-input` | REUTILIZAR conceitualmente | editor de condição de palavras-chave |
| `post-picker` | ADAPTAR | seletor dentro de Automação Instagram |
| `campaign-preview` | ADAPTAR | preview NEXORA |
| dashboard/stats/follower chart | ADAPTAR/opcional | cards NEXORA, sem dashboard paralelo |
| settings Instagram | ADAPTAR | Configurações → Canais/Integrações |
| pages SEO/landing/legal OpenReply | DESCARTAR | produto NEXORA já possui marca e documentos próprios |

## 8. Resultado da matriz

O valor reutilizável do OpenReply está principalmente em `lib/meta`, `lib/instagram`, `lib/queue/dm-worker.ts`, `lib/utils/keyword-matcher.ts`, `lib/utils/rate-limiter.ts`, `lib/polling/comment-reconciler.ts`, tracking e testes correspondentes. O restante deve ser substituído pelos domínios já maduros do NEXORA.
