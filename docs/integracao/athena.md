# Integração Athena — contrato v1 (preparação)

**Estado: PREPARAÇÃO. A integração está DESLIGADA por omissão e nenhuma
execução autónoma existe.** Este documento é o contrato entre o CRM e a
Athena: define como ela poderá *pedir* ações e *avisar* de eventos quando
a integração for ligada, numa fase futura e com autorização própria.
Ligar a flag não executa nada — só abre os endpoints de registo e de
decisão descritos abaixo.

## Princípios

1. **A Athena pede; um humano decide.** Todo o comando recebido vira um
   job em `pending_approval`. Nenhum comando executa na chegada, e nesta
   fase nem a aprovação executa — ela regista a decisão. O executor (a
   peça que transformaria `approved` em efeito) é uma fase separada, com
   autorização separada.
2. **A organização vem da credencial, nunca do pedido.** O token de
   serviço pertence a uma organização; `organization_id` é resolvido da
   linha do token. Um `organization_id` no corpo é ignorado por desenho —
   os esquemas nem o aceitam como fonte.
3. **Desligado é invisível.** Sem `ATHENA_INTEGRATION_ENABLED=true`, os
   endpoints de comandos e de webhook respondem `404`, como se não
   existissem. Só o health check responde sempre, para se poder distinguir
   "desligado" de "endereço errado".
4. **Fail-closed em tudo.** Sem segredo de webhook, o webhook é `404`.
   Assinatura inválida é `401`. Token sem o escopo é `403`.

## Endpoints

Base: `/api/v1/integrations/athena` (versão no caminho; uma v2 futura
viveria ao lado, sem quebrar esta).

| Método e caminho | Quem chama | Auth | Resposta quando desligada |
| --- | --- | --- | --- |
| `GET /health` | qualquer sonda | nenhuma | `200` com `enabled: false` |
| `POST /commands` | Athena | Bearer `dsk_...` (escopo `athena:commands`) ou sessão | `404` |
| `GET /commands/{job_id}` | Athena | idem | `404` |
| `POST /commands/{job_id}/decision` | **só um humano** | sessão + papel `admin` | `404` |
| `POST /webhook` | Athena | Bearer (escopo) **e** HMAC | `404` |

### Health

```json
{ "data": { "service": "athena-integration", "version": "v1",
            "enabled": false,
            "commands": ["contacts.create", "messages.send",
                         "appointments.create", "reports.generate"] } }
```

Não revela nada da instalação: nem organização, nem contagens, nem
versões internas.

### Criar um comando — `POST /commands`

Corpo:

```json
{ "command": "messages.send",
  "params": { "conversation_id": "…", "text": "…" },
  "reason": "o lead pediu uma proposta" }
```

- `command` é um enum fechado (o catálogo abaixo). Fora da lista → `422`.
- `params` é um objeto livre por comando; `reason` (≤ 500 caracteres) é o
  porquê, mostrado a quem aprova.
- Sucesso → `201` com `{ "job_id": "…", "command": "…", "state":
  "pending_approval" }`. **Nada foi executado.**

### Consultar um job — `GET /commands/{job_id}`

Devolve o job (`state`: `pending_approval` | `approved` | `rejected`,
quem decidiu e quando). Um job de outra organização responde `404` —
o id não é um canal para sondar o que é dos outros.

### A decisão humana — `POST /commands/{job_id}/decision`

```json
{ "decision": "approve", "note": "pode enviar" }
```

- Só sessão, só `admin` da organização do job, com a guarda de escrita
  de suporte. A rota nem está nos caminhos públicos: o proxy exige
  sessão, e um token de serviço não tem como decidir — quem pede nunca
  aprova o próprio pedido.
- Decidir um job já decidido → `409 conflict` com o estado atual.
- Aprovar **regista** a decisão; não executa o comando (ver Princípios).

### Webhook de entrada — `POST /webhook`

A Athena avisa de eventos dela (ex.: `mission.completed`):

```json
{ "event": "mission.completed", "data": { "mission_id": "…" } }
```

O aviso vira um evento `athena.webhook_received` no `event_log` da
organização do token. Nenhum handler o consome nesta fase.

## Autenticação serviço-a-serviço

- **Token por organização**: um token `dsk_...` de *Configurações →
  Tokens de API* (a mesma infraestrutura do MCP), guardado como hash
  SHA-256, com o escopo **`athena:commands`** nos `scopes` do token.
  Revogar o token desliga a Athena daquela organização, e só dela.
- Não há segredo de serviço global: um segredo em variável de ambiente
  identificaria "a Athena", mas não *de que organização* é o pedido —
  e aceitar a organização do corpo violaria o Princípio 2.
- O token herda os limites da casa: teto de escrita por recurso
  (`athena_commands` / `athena_webhooks`) e expiração opcional.
- Erros: sem token ou token inválido → `401 token_invalid`; token sem o
  escopo → `403 forbidden` com `required_scope: athena:commands`.

## Webhooks assinados (HMAC)

- Segredo partilhado em `ATHENA_WEBHOOK_SECRET` (mínimo de 32
  caracteres; vazio ou curto = webhook desligado, `404`).
- Assinatura: `HMAC-SHA256(segredo, corpo cru)` em hex, no cabeçalho
  `x-athena-signature` (aceita-se o prefixo `sha256=`).
- A comparação é em tempo constante e hasheia os dois lados antes de
  comparar (não vaza nem o comprimento). Verifica-se sobre o corpo
  **cru**, antes de qualquer parse de JSON.
- Assinatura inválida → `401 invalid_signature` **e** uma entrada de
  auditoria `athena.webhook_invalid_signature`.

## Comandos autorizados (catálogo v1)

| Comando | O que pediria (numa fase de execução) | Sensível |
| --- | --- | --- |
| `contacts.create` | criar um contato | sim |
| `messages.send` | enviar uma mensagem a um cliente | sim |
| `appointments.create` | criar um agendamento | sim |
| `reports.generate` | gerar um relatório | sim |

Todos são sensíveis — mexem com clientes, mensagens ou agenda — e por
isso **todos** passam pela aprovação humana. Acrescentar um comando é
mudar o contrato: `lib/integrations/athena/contrato.ts` e este
documento, na mesma alteração.

Fora do catálogo, por desenho e sem exceção nesta fase: faturação,
credenciais, apagar dados, alterar configurações da organização e
qualquer ação em massa.

## Jobs e estados

Os jobs vivem no `event_log` (a fila canónica), sem tabela nova:

- criar = emitir `athena.command_received` (`entity_kind:
  "athena_command"`, `entity_id: job_id`) pela RPC `emit_event`, com
  `payload.state = "pending_approval"` e os `params` no payload;
- a transição grava `state`, `decided_by` e `decided_at` no payload,
  com compare-and-swap sobre o payload lido: duas decisões simultâneas
  não passam as duas;
- o `status` do `event_log` fica `pending` e **nenhum handler está
  registado** para este tipo de evento — o drain ignora-o. É deliberado:
  neste desenho, nem um bug no pipeline de eventos executa um comando.

Transições possíveis: `pending_approval → approved` e
`pending_approval → rejected`. Não há caminho de volta, nem de
`approved` para execução nesta fase.

## Idempotência

`Idempotency-Key: <uuid>` (opcional) em `POST /commands` e
`POST /webhook`, com o recibo da casa (`lib/api/idempotency.ts`), por
organização e endpoint, 24 h:

- mesma chave + mesmo corpo → a resposta original, sem criar outro job;
- mesma chave + corpo diferente → `409 idempotency_conflict`;
- mesma chave ainda em curso → `409 idempotency_in_progress` (repetir
  dentro de instantes).

Chave que não seja UUID → `400`.

## Auditoria

Entradas em `audit_log` (vocabulário em `lib/audit/actions.ts`):
`athena.command_received`, `athena.command_approved`,
`athena.command_rejected`, `athena.webhook_received`,
`athena.webhook_invalid_signature`. O metadata traz o nome do comando, o
estado e a decisão — **nunca** os `params`, que podem carregar dados de
clientes.

## Erros e retries

Envelope da casa: `{ "error": { "code", "message", "request_id" } }` nos
falhos e `{ "data": …, "request_id" }` nos sucessos.

| Código | HTTP | O que a Athena deve fazer |
| --- | --- | --- |
| `not_found` | 404 | integração desligada ou job inexistente — **não** repetir às cegas; avisar um humano |
| `unauthorized` / `token_invalid` / `token_expired` | 401 | renovar o token; não repetir |
| `invalid_signature` | 401 | verificar o segredo e o corpo cru; não repetir |
| `forbidden` | 403 | o token não tem o escopo ou excedeu o teto — não repetir |
| `validation_failed` | 422 | corrigir o corpo contra este contrato; não repetir igual |
| `idempotency_conflict` | 409 | usar uma chave nova para um pedido novo |
| `idempotency_in_progress` | 409 | esperar alguns segundos e repetir com a **mesma** chave |
| `conflict` | 409 | o job já foi decidido; consultar o estado |
| `rate_limited` | 429 | backoff exponencial a partir de `retry_after` |
| `internal_error` | 500 | repetir com a mesma `Idempotency-Key` é seguro |

## Isolamento por tenant

Toda a leitura e escrita filtra por `organization_id` resolvida da
credencial. Um job de outra organização é indistinguível de um
inexistente (404 nos dois casos). A decisão filtra também por
organização: um admin só decide jobs da sua.

## Configuração (operador)

| Variável | Efeito |
| --- | --- |
| `ATHENA_INTEGRATION_ENABLED` | só o valor exato `true` liga; qualquer outra coisa (incl. erro de digitação) é desligado |
| `ATHENA_WEBHOOK_SECRET` | segredo HMAC ≥ 32 caracteres; vazio/curto desliga o webhook |

E, por organização: um token `dsk_...` com o escopo `athena:commands`.

## Limites conhecidos da v1

- A aprovação não executa: o estado `approved` é terminal nesta fase.
- Não há listagem de jobs (só consulta por id) nem fila de aprovação na
  UI — a decisão faz-se por API nesta fase.
- O compare-and-swap da decisão compara o payload inteiro; payloads
  grandes tornam a comparação mais pesada, o que é aceitável ao ritmo
  humano de aprovações.
