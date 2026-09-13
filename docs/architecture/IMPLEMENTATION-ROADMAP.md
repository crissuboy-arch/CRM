# Roadmap Incremental — NEXORA + Instagram/OpenReply

> Plano de execução futura. Nenhuma etapa foi implementada nesta análise. Cada fase deve sair em branch/PR próprio e só começa após aceite da anterior.

## Regras transversais

- NEXORA é a única interface, autenticação, organização, Inbox e CRM.
- Começar cada branch sincronizada com `main`, sem apagar trabalho alheio.
- Mudança de schema: migration nova + baseline idempotente + MANIFEST + tipos gerados.
- Toda tabela tenant-aware: RLS e teste cross-tenant.
- Toda rota: Zod, guard, `organization_id` confiável, `ok/fail`, audit em mutação.
- Toda tela nova: navegação registrada e prova visual.
- Não importar Prisma, Auth.js ou BullMQ.
- Preservar avisos MIT nos arquivos derivados.

## PHASE 0 — Backup, branch e baseline

**Objetivo:** congelar estado conhecido e criar uma régua reproduzível antes da integração.

**Arquivos envolvidos:** `AGENTS.md`, `CLAUDE.md`, `package.json`, `.env.example`, `lib/env.ts`, `supabase/migrations/`, `supabase/baseline.sql`, `docs/architecture/`, CI e documentação de licença.

**Componentes reutilizados:** governança, scripts de verificação, arquitetura/QA existentes.

**Banco:** nenhuma mudança.

**Env vars:** nenhuma nova.

**Dependências:** nenhuma.

**Ações:** branch `feat/instagram-foundation`; tag/backup do snapshot; inventário dos testes; ADRs: “capability port”, “event_log em vez de BullMQ”, “identidade multicanal”, “credenciais canônicas”; adicionar `THIRD_PARTY_NOTICES.md` com OpenReply commit `f37233f...`, Anish Raj e Diwen Huang.

**Riscos:** documentação divergir da `main`; começar sobre branch atrasada; remover avisos upstream.

**Critério de aceite:** baseline documentado; nenhum diff funcional; donos/revisores concordam com ADRs e matriz; licença preservada.

## PHASE 1 — Infraestrutura de canais

**Objetivo:** tornar Instagram um provider/canal reconhecido sem ainda conectar conta.

**Arquivos envolvidos:** `lib/channels/types.ts`, `lib/channels/index.ts`, `lib/channels/capabilities.ts`, `lib/channels/session-ref.ts`, `lib/channels/runtime.ts`, `lib/navigation/registry.ts`, schemas de mensagens, migrations/baseline/MANIFEST, testes de lint/canais.

**Componentes reutilizados:** `ChannelAdapter`, capabilities, session scope, health, before-send, Inbox/contacts/conversations/messages.

**Banco:** novo ramo `instagram_meta`; identidade externa generalizada; ajustes de vocabulary/constraints de `channel_sessions` e `conversations.channel`; delivery ledger se aprovado já nesta fase.

**Env vars:** declarar apenas nomes, sem configurar segredos: `INSTAGRAM_APP_ID`, `INSTAGRAM_APP_SECRET`, `INSTAGRAM_WEBHOOK_VERIFY_TOKEN`, `META_GRAPH_VERSION`; preferir credenciais de instalação no banco quando o padrão NEXORA exigir.

**Dependências:** nenhuma nova esperada.

**Riscos:** confundir `meta_cloud` (WhatsApp) com Instagram; queries assumirem telefone; constraints/FKs incompletas.

**Critério de aceite:** provider compila no registry; sessão não pode ligar entidades de outra org; canal ainda indisponível na UI por feature flag; testes de DB provam isolamento.

## PHASE 2 — Instagram connection

**Objetivo:** conectar/desconectar conta profissional via OAuth dentro de Configurações.

**Arquivos envolvidos:** novos `lib/channels/instagram/oauth-state.ts`, `oauth-client.ts`, `credentials.ts`, `account.ts`; rotas `app/api/v1/channels/instagram/{connect,callback,disconnect}`; componentes em `components/connections/`; central operacional; env schema.

**Componentes reutilizados:** Supabase Auth/RBAC, `safe-next`, cifra OAuth, `channel_sessions`, Connections UI, audit/logger/Sentry.

**Banco:** nonce OAuth single-use; campos/tabela 1:1 de conexão Instagram; token cifrado e expiração; status de subscription.

**Env vars:** app ID/secret, verify token, Graph version e base URL canônica. Secret sempre server-only.

**Dependências:** preferir `fetch` nativo e Zod existente.

**Riscos:** replay de state, redirect injection, conta conectada em org errada, token no frontend, escopos/App Review incompletos.

**Critério de aceite:** admin conecta e desconecta pela UI NEXORA; replay/expiry/wrong-org falham; token nunca aparece em rede do browser; audit e health visíveis.

## PHASE 3 — Webhooks

**Objetivo:** receber e arquivar comments, messages, postbacks e read receipts com segurança/idempotência.

**Arquivos envolvidos:** rota `app/api/v1/webhooks/instagram/[token]/route.ts` ou consolidação Meta existente; `lib/channels/instagram/webhook.ts`, `envelope.ts`; `webhook_events_log`; dispatcher/registry de eventos.

**Componentes reutilizados:** path token, HMAC patterns, arquivo de webhooks, logger, `event_log`.

**Banco:** chave dedup de evento; extensão segura do provider em `webhook_events_log`; event types novos.

**Env vars:** verify token/secret já declarados.

**Dependências:** nenhuma.

**Riscos:** ler JSON antes de validar raw body; body preview com PII; 500 causar tempestade de retries; evento sem consumidor.

**Critério de aceite:** fixtures assinadas passam; assinatura inválida e payload fora do contrato falham; replay produz uma linha/efeito; resposta rápida após persistência; todo evento emitido tem consumer registrado.

## PHASE 4 — Instagram Inbox integrado

**Objetivo:** DMs aparecem e podem ser respondidas no Inbox existente.

**Arquivos envolvidos:** `lib/channels/instagram/ingest.ts`, `adapter.ts`, `components/inbox/*`, APIs de conversations/messages, Realtime/queries, media pipeline, `lib/channels/pos-entrada.ts`.

**Componentes reutilizados:** contacts/conversations/messages, Inbox, assignment, unread, notes, tags, media Storage, lead birth, opt-out, agent dispatch.

**Banco:** nenhuma tabela de Inbox nova; possíveis índices/constraints de identidade e conversation provider ID.

**Env vars:** nenhuma além da conexão.

**Dependências:** nenhuma.

**Riscos:** contato duplicado, telefone obrigatório em código compartilhado, eco outbound virar inbound, janela Meta, mídia efêmera.

**Critério de aceite:** uma DM cria/resolve contact→conversation→message→lead; aparece no filtro Instagram; resposta sai e eco não duplica; duas orgs não vazam; opt-out/IA/follow-up usam o mesmo pós-entrada.

## PHASE 5 — Comment → DM

**Objetivo:** comentário qualificado dispara resposta privada e, opcionalmente, resposta pública.

**Arquivos envolvidos:** parsers, matcher, actions de automação Instagram, delivery ledger, UI de regra/campanha, seletor de post, runs/logs.

**Componentes reutilizados:** `automation_rules`, `automation_rule_runs`, event engine, tracked message, OpenReply keyword matcher/Meta send logic portados.

**Banco:** binding regra/sessão/media se necessário; ledger durável; nenhuma tabela `instagram_automations`.

**Env vars:** nenhuma.

**Dependências:** nenhuma.

**Riscos:** DM duplicada, self-comment, post impulsionado com media ID diferente, resposta pública repetir após falha da DM, limite Meta.

**Critério de aceite:** keywords Unicode whole/partial; self-comment ignorado; `original_media_id` casa; DM/public reply têm estados independentes; replay/crash não duplicam; runs visíveis.

## PHASE 6 — Story/DM triggers

**Objetivo:** mensagens e respostas a Story acionam regras/palavras-chave.

**Arquivos envolvidos:** parser de messages, envelope de contexto, trigger registry, conditions/actions, Inbox/message flow.

**Componentes reutilizados:** `message.received`, automation engine, OpenReply parsing/postbacks/read fallback.

**Banco:** metadata mínima de Story/context; nenhuma tabela de Story.

**Env vars:** nenhuma.

**Dependências:** nenhuma.

**Riscos:** loop por eco do próprio envio, attachment sem texto, contexto Story ausente, janela de messaging.

**Critério de aceite:** DM e Story reply entram na mesma Inbox; echo/deleted/unsupported ignorados conforme contrato; keyword dispara uma vez; fallback de botão/read é idempotente.

## PHASE 7 — Campanhas e tracking

**Objetivo:** campanhas Instagram configuráveis com links rastreados e atribuição até o CRM.

**Arquivos envolvidos:** UI Automação/Campanhas, tracked redirect route, analytics, Meta Ads attribution bridge, reports.

**Componentes reutilizados:** automation rules, ad insights/conversions, lead activities/links, métricas NEXORA; algoritmo OpenReply de tracked buttons.

**Banco:** `tracked_links`/`tracked_link_clicks` se inexistentes; vínculo com regra, contato e lead; retenção LGPD.

**Env vars:** sal/chave de hash rotativo se necessário, nunca em `NEXT_PUBLIC_*`.

**Dependências:** nenhuma.

**Riscos:** open redirect, coleta excessiva, CTR >100 por semântica errada, slug enumerável, atribuição dupla.

**Critério de aceite:** clique registra sem IP bruto; destino validado; campanha mostra sends/clicks/CTR/leads; lead fechado pode reportar conversão pelo módulo Meta existente; duplicar campanha não herda métricas/slugs.

## PHASE 8 — Automação + CRM/funil

**Objetivo:** ações Instagram alimentam pipeline, tarefas, follow-ups e timeline sem duplicação.

**Arquivos envolvidos:** actions `create-or-move-lead`, lead birth/activity/link, follow-up enrollment, CRM side panel, timeline.

**Componentes reutilizados:** todo CRM/follow-up NEXORA.

**Banco:** apenas novos vocabulários/links polimórficos se necessários; evitar colunas duplicadas em leads.

**Env vars:** nenhuma.

**Dependências:** nenhuma.

**Riscos:** múltiplos leads ativos por contato, movimentos repetidos, opt-out ignorado, automação e agente competirem.

**Critério de aceite:** regra pode criar/mover lead e iniciar flow; cada efeito aparece na timeline; opt-out cancela envios; idempotência impede cards/tarefas duplicados.

## PHASE 9 — IA

**Objetivo:** permitir que agentes NEXORA atendam Instagram sob os mesmos guardrails e handoff.

**Arquivos envolvidos:** channel adapter no agent engine, eligibility, before-send, messaging window, agent mapping, UI de acesso do canal.

**Componentes reutilizados:** AI agents, RAG, routing, budgets, memory, handoff, pacing, audit.

**Banco:** possíveis vínculos agent↔channel já suportados por `channel_sessions`/pipeline mapping; evitar entidades específicas Instagram.

**Env vars:** nenhuma específica de IA.

**Dependências:** nenhuma.

**Riscos:** IA responder fora da janela, loop com automação, promessas/guardrails não adaptados ao canal, custo e corrida humano×IA.

**Critério de aceite:** agente responde via adapter; handoff pausa IA; operador retoma; guardrails/opt-out/window valem; run/custo/citação ficam no painel existente.

## PHASE 10 — Hardening e produção

**Objetivo:** preparar operação real, App Review e rollback.

**Arquivos envolvidos:** Docker/compose/scheduler apenas se necessário, health, diagnostics, runbooks, Meta review docs, threat model, CI/E2E.

**Componentes reutilizados:** imagens app/worker/scheduler, Sentry, central operacional, health checks, CI.

**Banco:** retenção, índices medidos, DLQ/reconciliation final; nenhuma mudança destrutiva sem migração de dados.

**Env vars:** documentação final, validação fail-closed e defaults compatíveis com instalações antigas.

**Dependências:** revisar advisories e lockfile; não adicionar stack paralela.

**Riscos:** worker não permanente, permissões Meta recusadas, token expirar, rate limit real divergir, rollback deixar subscription ativa.

**Critério de aceite:** testes unit/DB/E2E relevantes; crash/restart sem duplicação; carga/rate-limit; runbooks; alerta de token/worker; instalação fresca atualiza via baseline; rollback testado; App Review checklist completo.

## Sequência de releases recomendada

1. Infraestrutura escondida por feature flag.
2. Conexão + webhook em ambiente de teste.
3. Inbox Instagram para organização piloto.
4. Comment→DM sem follow gate avançado.
5. Story/postback/follow gate.
6. Tracking/CRM/follow-up.
7. IA.
8. Disponibilidade geral após hardening.

## Gates de interrupção

Parar a implementação se:

- a `main` ou migrations mais recentes divergirem deste snapshot;
- o modelo de provider/canal exigir reinterpretar dados `meta_cloud` existentes;
- não houver estratégia de idempotência durável;
- segredo/token precisar atravessar o frontend;
- um novo módulo duplicar Inbox, contatos, CRM, auth ou follow-up;
- permissões Meta necessárias não estiverem disponíveis para o tipo de app/conta escolhido;
- licença/atribuição de arquivo portado não puder ser rastreada.

## MASTER IMPLEMENTATION PROMPT

O prompt autocontido está em `MASTER-IMPLEMENTATION-PROMPT.md`. Ele faz parte desta entrega e deve ser usado somente depois da aprovação desta arquitetura.
