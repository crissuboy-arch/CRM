# MASTER IMPLEMENTATION PROMPT

Você atuará como Principal Software Engineer e executará, em fases, a integração das capacidades Instagram do OpenReply dentro do NEXORA CRM.

## Repositórios

- Produto principal: NEXORA CRM — `https://github.com/crissuboy-arch/CRM.git`
- Referência open-source: OpenReply — `https://github.com/diwenne/openreply.git`
- Snapshot OpenReply analisado: commit `f37233fb5f531208582a8a99eee8c109c06b108b`

## Resultado obrigatório

O usuário deve enxergar somente NEXORA. Não crie dois produtos, duas interfaces, duas autenticações, dois bancos de contatos, dois CRMs, dois Inboxes ou um OpenReply copiado para uma pasta.

NEXORA é a fonte de verdade para:

- Supabase Auth, MFA e sessão;
- `organizations`/`user_organizations` e RBAC;
- `contacts`, `conversations`, `messages` e Inbox;
- `crm_pipelines`, `crm_stages`, `crm_leads`, activities, links e tasks;
- `automation_rules`/runs;
- `followup_flow_*`/enrollments;
- `event_log`, `job_queue`, workers e crons;
- `ai_agents`/RAG/guardrails/handoff;
- Meta Ads insights/conversions;
- audit, Sentry, central operacional, branding e navegação.

OpenReply é apenas fonte de lógica Instagram madura: OAuth, token lifecycle, subscriptions, parsers de comments/messages/postbacks/read, `original_media_id`, keyword matching, comment→DM, public reply, opening DM/button, follow gate, tracked links, dedup, rate-limit e reconciliation.

## Restrições absolutas

1. Leia integralmente `AGENTS.md` e `CLAUDE.md` do NEXORA antes de alterar código.
2. Inspecione a `main` atual e compare-a com os documentos de arquitetura; nunca presuma que o snapshot ainda é idêntico.
3. Não importe Auth.js/NextAuth, Prisma, BullMQ ou uma segunda instância Redis TCP sem ADR aprovado. O desenho esperado não precisa deles.
4. Não crie `instagram_contacts`, `instagram_conversations`, `instagram_messages`, `instagram_automations`, `instagram_campaigns` ou `workspaces` paralelos.
5. Não reescreva módulos maduros NEXORA; estenda os seams existentes.
6. Não misture Instagram com o provider `meta_cloud`, que no NEXORA significa WhatsApp Cloud. Use discriminante próprio, por exemplo `instagram_meta`, validado contra o padrão atual.
7. Nenhum secret/token no frontend, `NEXT_PUBLIC_*`, query string, log ou erro mostrado ao usuário.
8. Toda query service-role filtra `organization_id` de fonte confiável; nunca aceite org do payload externo.
9. Trigger Postgres nunca faz HTTP.
10. Não execute todas as fases de uma vez. Faça uma fase por branch/PR, pare e apresente evidências para aprovação.
11. Não corrija problemas não relacionados.
12. Preserve licenças MIT e autoria original. Arquivos derivados devem apontar para OpenReply/commit e manter copyright de Anish Raj e Diwen Huang. Preserve também o copyright de Rafael Melgaço no NEXORA. Não atribua autoria original à NEXORA.

## Arquitetura obrigatória

Fluxo inbound:

`Meta webhook → assinatura/raw-body → arquivo/idempotência → event_log → normalizador Instagram → contact_channel_identity → contact → conversation → message → aplicarEfeitosPosEntrada → lead/follow-up/automação/IA → Inbox NEXORA`.

Fluxo comment→DM:

`instagram.comment_received → automation_rules matcher → delivery ledger reserve → rate limit reserve → Instagram adapter → message/run/activity → tracking`.

Separar delivery state da DM e da resposta pública. Falha em uma não repete automaticamente a outra.

## Banco alvo

Reutilize entidades NEXORA. Avalie somente estas adições mínimas:

- `contact_channel_identities` para mapear IGSID/external user ID a `contacts`;
- campos Instagram em `channel_sessions` ou tabela 1:1 `instagram_channel_connections` se o discriminante já estiver saturado;
- `channel_delivery_ledger` para idempotência durável de side effects;
- `channel_automation_bindings` apenas se JSON em `automation_rules` não der índices/FKs/uniques necessários;
- `tracked_links`/`tracked_link_clicks` somente se não existir equivalente atual;
- snapshots de métricas somente se aprovados como requisito.

Toda tabela tenant-aware: `organization_id not null`, RLS, FKs compostas quando necessárias e teste real com duas organizações. Toda mudança de schema: migration nova idempotente + apêndice no `supabase/baseline.sql` + MANIFEST + regeneração de tipos. Nunca edite migration aplicada.

## Segurança obrigatória

- OAuth state com nonce criptográfico persistente, single-use, TTL curto e vínculo org+user+redirect.
- Callback exige sessão Supabase e membership/papel na mesma org.
- Redirects allowlisted.
- Tokens cifrados com `fn_encrypt_oauth`/`fn_decrypt_oauth`, service-role only, fail-closed.
- GET webhook verifica challenge/token; POST verifica `x-hub-signature-256` sobre raw body antes do parse.
- Não grave preview de body com PII em erro de assinatura.
- Body limit e Zod para todo envelope externo.
- Idempotência em webhook, entidades, execução de regra e side effects.
- Estado `uncertain` quando a rede falha após possível envio; não retry cego.
- Rate limit atômico por conta/operação, configurável e atento a `Retry-After`; sem fallback em memória em produção multi-instância.
- Opt-out NEXORA veta campanha/follow-up/IA antes de qualquer novo envio.
- Tracking sem IP bruto, com destino protegido contra open redirect/SSRF e retenção LGPD.

## Plano de execução

### PHASE 0 — Baseline

Crie branch, sincronize com `main`, verifique árvore limpa, registre ADRs, inventário e `THIRD_PARTY_NOTICES.md`. Não altere comportamento. Pare para aprovação.

### PHASE 1 — Channel foundation

Adicione o discriminante Instagram, capabilities, session reference e identidade multicanal. Schema completo conforme doutrina. Mantenha feature flag desligada. Prove RLS/constraints e pare.

### PHASE 2 — Instagram connection

Implemente OAuth connect/callback/disconnect, nonce single-use, token longo/refresh e subscription. Use UI de Connections NEXORA. Prove replay/expiry/wrong-org/token invisível e pare.

### PHASE 3 — Webhooks

Implemente challenge, HMAC/raw body, Zod/envelope, arquivo e emissão no `event_log`. Porte parsers OpenReply com atribuição. Prove invalid signature, replay e consumer registrado. Pare.

### PHASE 4 — Inbox

Normalize DM em contacts/conversations/messages, adicione filtro Instagram na Inbox e adapter de resposta. Reuse `aplicarEfeitosPosEntrada`. Prove DM→contact→conversation→message→lead, echo dedup e cross-tenant. Pare.

### PHASE 5 — Comment→DM

Porte matcher, media/original media matching, self-comment filter, private/public replies, rate limit e ledger. Construa UI NEXORA sobre `automation_rules`. Prove independência dos dois envios, crash/replay e logs. Pare.

### PHASE 6 — Story/DM triggers

Porte messages/postbacks/read fallback. Story reply deve reutilizar `message.received`, sem tabela/motor próprio. Prove echo/deleted/unsupported e idempotência. Pare.

### PHASE 7 — Campaigns/tracking

Implemente tracked links/buttons e atribuição até lead/Meta Ads existente. Proteja redirect/PII. Prove métricas e duplicação de campanha sem herdar slugs/runs. Pare.

### PHASE 8 — CRM/follow-up

Conecte ações a create/move lead, tasks, timeline e enrollment no motor NEXORA. Prove opt-out e ausência de duplicação. Pare.

### PHASE 9 — IA

Conecte Instagram ao agent engine existente, incluindo mapping, eligibility, guardrails, window e handoff. Prove disputa humano×IA e rastreabilidade. Pare.

### PHASE 10 — Hardening

Faça health/token alerts, retries/DLQ/reconciliation, testes de carga/crash, E2E visual, runbooks, instalação fresca, rollback e checklist de App Review. Pare para go-live explícito.

## Formato obrigatório de cada entrega de fase

Antes de editar:

1. resumo do estado observado na `main`;
2. arquivos exatos que serão tocados;
3. schema/env/dependências;
4. riscos e plano de rollback;
5. critérios de aceite executáveis.

Depois de editar:

1. diff funcional por arquivo;
2. migrations/baseline/MANIFEST e prova de RLS, quando aplicável;
3. testes realmente executados e seus resultados, sem alegar testes não rodados;
4. evidência visual para UI;
5. licença/atribuição dos trechos portados;
6. itens pendentes e riscos residuais;
7. commit/branch/PR e instrução clara para aprovar antes da próxima fase.

## Critério final

A integração estará concluída somente quando o usuário puder, dentro do NEXORA, conectar Instagram, receber e responder DMs na Inbox existente, transformar a pessoa em contato/lead, criar comentário→DM e Story/DM triggers, acompanhar campanha/tracking, iniciar follow-ups e permitir atendimento por agente IA — sem perceber ou administrar um segundo produto e sem duplicação de auth, tenant, contato, conversa, Inbox, CRM, fila ou automação.
