# ATHENA ↔ NEXORA CRM — Contrato Oficial de Integração

| | |
|---|---|
| **Produto** | NEXORA CRM |
| **Consumidor** | Athena (via Athena Control) |
| **Versão do contrato** | `v1` (primeira versão oficial neste padrão) |
| **Estado** | **IMPLEMENTADO no código nesta branch; NÃO está no ar em nenhum ambiente; ligar exige deploy autorizado + registo na Athena Control** |
| **Data** | 2026-10-22 |
| **Base URL** | `https://<instalação-do-nexora>` (ex.: a URL do staging/produção da instalação) |

> **Sentido da integração (decisão arquitetural):** a **Athena consome APIs HTTPS
> autenticadas do NEXORA**, no mesmo padrão já usado pela Athena Control com a
> VitrinePro e pelo adapter editorial com o TrendHub USA. O NEXORA **não** chama a
> Athena, **não** recebe webhooks da Athena e **não** fala com o Cris OS.
>
> **Estado real:** este contrato está **implementado no código** desta branch
> (rotas em `app/api/v1/integrations/athena/`, biblioteca em
> `lib/integrations/athena/`). **Não está no ar em nenhum ambiente**: nenhum
> deploy foi feito e a integração continua **desligada por omissão**
> (`ATHENA_INTEGRATION_ENABLED` ≠ `true` → os endpoints autenticados respondem
> `404`). Ligar exige, por esta ordem: deploy autorizado desta branch,
> emissão de uma credencial por organização e registo na Athena Control
> (secção 10). Nada aqui é uma integração simulada apresentada como real.

---

## 1. Princípios

1. **A Athena pede; um humano decide; executar é outra fase.** Solicitar uma ação
   regista um pedido em `pending_approval`. Nada executa na chegada. Aprovar
   regista a decisão — também não executa (o executor, se um dia for autorizado,
   é uma fase separada, com autorização separada e testes próprios).
2. **A organização vem da credencial, nunca do pedido.** Cada credencial pertence
   a uma organização do NEXORA. Um `organization_id` no corpo é ignorado por
   desenho — os esquemas nem o aceitam como fonte.
3. **Desligado é invisível.** Sem a integração ligada para a organização, os
   endpoints autenticados respondem `404`, como se não existissem. Só o *health*
   responde sempre, para distinguir "desligado" de "endereço errado".
4. **Fail-closed em tudo.** Sem credencial → `401`. Credencial sem o escopo →
   `403`. Ação de outra organização → `404` (indistinto de inexistente).
5. **Só agregados saem.** Estatísticas são contagens e totais da organização da
   credencial — nunca registos individuais de clientes, conversas ou leads.
6. **Segredo nunca no frontend, nunca em URL.** A credencial só viaja no header
   `Authorization`. O plaintext é mostrado uma única vez, na emissão.

---

## 2. Autenticação e escopos

### 2.1 A credencial

- **Formato:** token opaco `dsk_<prefixo-8-hex>_<segredo-32-bytes-base64url>` —
  a mesma infraestrutura de tokens de API que o NEXORA já usa para o MCP
  (`api_tokens`).
- **Emissão:** um administrador da organização emite a credencial em
  *Configurações → Tokens de API* (ou `POST /api/v1/settings/api-tokens`,
  sessão admin). O plaintext aparece **uma vez**; deve ser colado de imediato no
  cofre da Athena Control (secção 9) — nunca enviado por chat nem guardado em
  texto simples.
- **Armazenamento no NEXORA:** apenas `prefix` + **hash SHA-256** do plaintext.
  Não existe forma de recuperar o plaintext a partir do NEXORA.
- **Uma credencial por organização.** Se a Athena servir várias organizações do
  mesmo NEXORA, regista uma credencial por organização no cofre, cada uma com os
  seus escopos. Não existe credencial "de plataforma" neste contrato.
- **Expiração:** opcional, definida na emissão (1–365 dias). Credencial expirada
  → `401 token_expired`.
- **Revogação:** imediata, pelo administrador da organização (*Tokens de API →
  Revogar*). Credencial revogada → `401 token_invalid` no pedido seguinte.
  Revogar desliga a Athena **daquela organização, e só dela**.
- **Rotação:** emitir uma credencial nova (mesmos escopos), registá-la no cofre
  da Control, confirmar com uma chamada ao *health* autenticado ou às
  *capabilities*, e revogar a antiga.
- **Limites herdados da casa:** teto de credenciais ativas por organização
  (imposto pelo banco) e tetos de escrita por recurso aplicados às ações
  (secção 8).

### 2.2 Escopos (lista fechada)

| Escopo | Dá acesso a |
|---|---|
| `athena:stats` | `GET /stats` — estatísticas agregadas da organização |
| `athena:capabilities` | `GET /capabilities` — capacidades e catálogo de ações da organização |
| `athena:actions` | `POST /actions`, `GET /actions/{id}`, `GET /actions/{id}/approval` — pedir ações e consultar os **seus** pedidos e a evidência de aprovação |

O *health* é público (sem escopo), como nos precedentes. Escopo em falta →
`403 forbidden` com `required_scope` no corpo do erro. A decisão humana sobre
uma ação **não** é um escopo: nenhuma credencial pode decidir (secção 6).

### 2.3 Cabeçalhos

```http
Authorization: Bearer dsk_<prefixo>_<segredo>
Idempotency-Key: <uuid>            # obrigatório em POST /actions (secção 5)
Content-Type: application/json
```

---

## 3. Endpoints

Base de todos os caminhos: **`/api/v1/integrations/athena`**

| # | Método e caminho | Auth | Estado |
|---|---|---|---|
| 3.1 | `GET /health` | nenhuma | implementado — payload plano alinhado à Control |
| 3.2 | `GET /stats` | Bearer · `athena:stats` | implementado |
| 3.3 | `GET /capabilities` | Bearer · `athena:capabilities` | implementado |
| 3.4 | `POST /actions` | Bearer · `athena:actions` | implementado (era `POST /commands` na preparação v1 — ver secção 11) |
| 3.5 | `GET /actions/{action_id}` | Bearer · `athena:actions` | implementado (era `GET /commands/{id}` na preparação v1) |
| 3.6 | `GET /actions/{action_id}/approval` | Bearer · `athena:actions` | implementado |
| 3.7 | `POST /actions/{action_id}/decision` | **só sessão humana** (admin da organização) | implementado (era `.../commands/{id}/decision` na preparação v1) |

**Convenções de formato** (iguais às dos precedentes, para a Control consumir sem
casos especiais):

- *Health*, *stats* e *capabilities* respondem **JSON plano** (sem envelope), no
  formato que a Athena Control já consome da VitrinePro.
- As rotas de *ações* usam o envelope padrão da API versionada do NEXORA:
  sucesso `{ "data": …, "request_id": "…" }`; erro
  `{ "error": { "code", "message", "request_id" } }`.
- Todas as respostas levam `X-Request-Id` e `Cache-Control: no-store`.
- JSON em `snake_case`; datas ISO-8601 em UTC; IDs são UUID.

### 3.1 Health — `GET /api/v1/integrations/athena/health`

Sonda de conectividade e de estado. Sem autenticação, sem acesso a dados, sem
efeitos colaterais. Responde sempre — mesmo com a integração desligada
(`enabled: false`).

**Resposta `200`:**

```json
{
  "platform": "NEXORA CRM",
  "status": "operational",
  "version": "0.1.0",
  "contract": "v1",
  "capabilities": ["integrations:health"],
  "enabled": true,
  "timestamp": "2026-10-22T09:00:00.000Z"
}
```

| Campo | Significado |
|---|---|
| `platform` | Nome do produto (`NEXORA CRM`) |
| `status` | `operational` · `degraded` |
| `version` | Versão da instalação do NEXORA |
| `contract` | Versão deste contrato (`v1`) |
| `capabilities` | Capacidades públicas ativas nesta fase (só leitura) |
| `enabled` | A integração está ligada nesta instalação (a ativação por organização confirma-se nas *capabilities*, com credencial) |
| `timestamp` | Instante da resposta (UTC) |

Não revela organizações, contagens nem versões internas além das acima.

### 3.2 Estatísticas — `GET /api/v1/integrations/athena/stats`

Agregados **da organização da credencial**, reutilizando as agregações que o
painel do NEXORA já calcula (funil, canais, atendimento). Só contagens — nenhum
registo individual sai por esta rota.

**Pedido:**

```http
GET /api/v1/integrations/athena/stats
Authorization: Bearer dsk_…
```

**Resposta `200`:**

```json
{
  "platform": "NEXORA CRM",
  "contract": "v1",
  "organization": { "id": "3f6b…", "name": "Empresa Exemplo" },
  "conversations": { "open": 12, "in_progress": 5, "closed_30d": 148 },
  "leads": { "total": 320, "new_30d": 41 },
  "contacts": { "total": 512 },
  "agents": { "configured": 2, "active": 1, "runs_30d": 96 },
  "support": { "cases_open": 3 },
  "generated_at": "2026-10-22T09:00:00.000Z",
  "timestamp": "2026-10-22T09:00:00.000Z"
}
```

> Os grupos e campos exatos são fechados na implementação a partir das
> agregações reais do painel (funil/canais/atendimento) — o contrato fixa a
> forma (grupos de contagens + `generated_at`), não promete métricas que o
> produto ainda não calcule.

**Erros:** `401` sem credencial válida · `403` sem o escopo `athena:stats` ·
`404` com a integração desligada · `429` acima do limite (secção 8).

### 3.3 Capacidades — `GET /api/v1/integrations/athena/capabilities`

O que a Athena pode pedir **nesta organização**: catálogo de ações, estados
suportados e configuração resumida do agente. É a rota que a Athena consulta
antes de propor qualquer ação.

**Resposta `200`:**

```json
{
  "platform": "NEXORA CRM",
  "contract": "v1",
  "organization": { "id": "3f6b…", "name": "Empresa Exemplo" },
  "integration": { "enabled": true },
  "actions": [
    { "type": "contacts.create",     "sensitive": true, "requires_approval": true },
    { "type": "messages.send",       "sensitive": true, "requires_approval": true },
    { "type": "appointments.create", "sensitive": true, "requires_approval": true },
    { "type": "reports.generate",    "sensitive": true, "requires_approval": true }
  ],
  "action_states": ["pending_approval", "approved", "rejected"],
  "agent": { "configured": true, "active": true },
  "timestamp": "2026-10-22T09:00:00.000Z"
}
```

**Erros:** `401` · `403` (escopo `athena:capabilities`) · `404` desligada.

### 3.4 Solicitar uma ação — `POST /api/v1/integrations/athena/actions`

Regista um pedido de ação. **Não executa nada** — o pedido nasce em
`pending_approval` à espera da decisão humana (secção 6).

**Pedido:**

```http
POST /api/v1/integrations/athena/actions
Authorization: Bearer dsk_…
Idempotency-Key: 9b1d…(uuid)
Content-Type: application/json

{
  "type": "messages.send",
  "params": { "conversation_id": "…", "text": "…" },
  "reason": "o lead pediu uma proposta"
}
```

| Campo | Regras |
|---|---|
| `type` | Enum fechado — o catálogo da secção 7. Fora da lista → `422`. |
| `params` | Objeto próprio de cada tipo de ação. |
| `reason` | Opcional, ≤ 500 caracteres. É o porquê mostrado a quem aprova. |
| `organization_id` | **Não é aceite como fonte** — a organização é a da credencial. |

**Resposta `201`:**

```json
{
  "data": {
    "action_id": "7c2e…",
    "type": "messages.send",
    "state": "pending_approval",
    "created_at": "2026-10-22T09:01:00.000Z"
  },
  "request_id": "…"
}
```

**Erros:** `400` `Idempotency-Key` em falta ou não-UUID · `401` · `403` (escopo
ou teto de escrita) · `404` desligada · `409 idempotency_conflict` /
`idempotency_in_progress` (secção 5) · `422 validation_failed` (tipo fora do
catálogo ou `params` inválidos) · `429`.

### 3.5 Consultar o estado de uma ação — `GET /api/v1/integrations/athena/actions/{action_id}`

**Resposta `200`:**

```json
{
  "data": {
    "action_id": "7c2e…",
    "type": "messages.send",
    "state": "approved",
    "reason": "o lead pediu uma proposta",
    "created_at": "2026-10-22T09:01:00.000Z",
    "decided_at": "2026-10-22T09:05:31.000Z"
  },
  "request_id": "…"
}
```

Uma ação de outra organização responde `404` — o ID não é um canal para sondar
o que é dos outros. Os `params` **não** são devolvidos a quem pede (podem conter
dados de clientes); a evidência da decisão vem da rota 3.6.

### 3.6 Evidência de aprovação humana — `GET /api/v1/integrations/athena/actions/{action_id}/approval`

Devolve o recibo verificável da decisão humana: quem decidiu, quando, com que
papel, e a referência que a Athena apresenta na Control. É o equivalente, neste
produto, ao `approvalRef` do padrão TrendHub — com uma diferença de natureza:
lá a evidência é um ficheiro versionado no repositório do produto (um produto de
conteúdo em git); aqui é o **registo de auditoria** do NEXORA, verificável por
esta rota com a credencial.

**Resposta `200` (ação já decidida):**

```json
{
  "data": {
    "action_id": "7c2e…",
    "state": "approved",
    "approval_ref": "nexora://actions/7c2e…/approval",
    "decision": "approve",
    "decided_by": { "user_id": "a1b2…", "role": "admin" },
    "decided_at": "2026-10-22T09:05:31.000Z",
    "note": "pode enviar",
    "audit": { "log_id": "e5f6…", "action": "athena.command_approved" }
  },
  "request_id": "…"
}
```

**Resposta `200` (ainda pendente):**

```json
{
  "data": {
    "action_id": "7c2e…",
    "state": "pending_approval",
    "approval_ref": null,
    "decision": null
  },
  "request_id": "…"
}
```

A decisão, uma vez registada, é imutável neste contrato: não há rota para a
alterar nem para a apagar. A trilha completa (pedido → decisão) fica no
`api_audit_log` da organização.

### 3.7 A decisão humana — `POST /api/v1/integrations/athena/actions/{action_id}/decision`

**Não é uma rota da integração.** Existe para o humano decidir dentro do
NEXORA e fica documentada aqui para o fluxo ser completo:

- Só **sessão** de utilizador, só papel `admin` **da organização da ação**, com a
  guarda de escrita de suporte da casa. A rota nem é pública para tokens: quem
  pede nunca aprova o próprio pedido.
- Corpo: `{ "decision": "approve" | "reject", "note": "…" }`.
- Decidir uma ação já decidida → `409 conflict` com o estado atual
  (compare-and-swap: duas decisões simultâneas não passam as duas).
- Aprovar **regista** a decisão e emite a evidência (3.6). Não executa a ação.

---

## 4. Estados de uma ação

```
pending_approval ──► approved      (decisão humana: aprovar)
                 └─► rejected      (decisão humana: rejeitar)
```

- `pending_approval` — pedido registado, ninguém decidiu.
- `approved` — um admin da organização aprovou. **Terminal neste contrato.**
- `rejected` — um admin rejeitou. Terminal.

Não há caminho de volta de um estado terminal, nem de `approved` para execução
neste contrato. Se uma fase futura de execução for autorizada, os estados
`executing` / `executed` / `failed` serão acrescentados por uma nova versão
deste contrato — nunca por alteração silenciosa desta.

---

## 5. Idempotência e proteção contra repetição

`POST /actions` exige `Idempotency-Key: <uuid>` (sem chave ou não-UUID → `400`).
A semântica é a do recibo de idempotência que o NEXORA já implementa:

- **Mesma chave + mesmo corpo** → a resposta original (`201` com o mesmo
  `action_id`), sem criar outro pedido. Repetir é seguro.
- **Mesma chave + corpo diferente** → `409 idempotency_conflict`. Um pedido novo
  usa uma chave nova.
- **Mesma chave ainda em curso** → `409 idempotency_in_progress`; repetir dentro
  de segundos, com a **mesma** chave.
- **Unicidade:** por (organização, chave, endpoint). A chave é reservada
  **antes** do efeito (reserva atómica no banco) — duas submissões simultâneas
  com a mesma chave produzem exatamente um pedido.
- **Janela:** o recibo vale **24 h**. Depois disso, a mesma chave é tratada
  como um pedido novo.
- **Retry após `500`:** repetir com a mesma chave é seguro por desenho.

---

## 6. Aprovações (resumo normativo)

1. Todas as ações do catálogo são sensíveis e exigem aprovação humana — sem
   exceções neste contrato.
2. Quem aprova é um **admin da organização**, autenticado por **sessão** no
   NEXORA. Nem a credencial da integração, nem a Athena, nem outro token podem
   decidir.
3. A evidência é o registo de auditoria + a rota 3.6 (`approval_ref`). A Athena
   apresenta a `approval_ref` na Athena Control, como faz com o `approvalRef`
   do TrendHub.
4. **Solicitar ≠ aprovar ≠ executar.** Este contrato cobre solicitar, consultar
   e provar a decisão. Executar está fora — deliberadamente.

---

## 7. Catálogo de ações (v1)

| Tipo | O que pede | Sensível |
|---|---|---|
| `contacts.create` | criar um contacto | sim |
| `messages.send` | enviar uma mensagem a um cliente | sim |
| `appointments.create` | criar um agendamento | sim |
| `reports.generate` | gerar um relatório | sim |

Acrescentar um tipo é mudar o contrato (nova versão deste documento e do
catálogo no código, na mesma alteração).

**Fora do catálogo, por desenho e sem exceção:** faturação, credenciais,
apagar dados, alterar configurações da organização e qualquer ação em massa.

---

## 8. Erros e retries

Envelope de erro (rotas de ações): `{ "error": { "code", "message",
"request_id" } }`. Nas rotas planas (health/stats/capabilities), o erro é
`{ "error": "…" }` com o mesmo código HTTP, como nos precedentes.

| Código | HTTP | Significado | O que a Athena deve fazer |
|---|---|---|---|
| `bad_request` | 400 | `Idempotency-Key` em falta/não-UUID ou corpo ilegível | corrigir o pedido; não repetir igual |
| `unauthorized` / `token_invalid` / `token_expired` | 401 | sem credencial, credencial inválida/revogada ou expirada | verificar a credencial no cofre; não repetir |
| `forbidden` | 403 | credencial sem o escopo exigido (`required_scope` no corpo) ou teto de escrita excedido | pedir ao admin da organização uma credencial com o escopo; não repetir |
| `not_found` | 404 | integração desligada **ou** ação inexistente/de outra organização (indistintos) | avisar um humano; não repetir às cegas |
| `idempotency_conflict` | 409 | mesma chave, corpo diferente | chave nova para um pedido novo |
| `idempotency_in_progress` | 409 | mesma chave ainda em curso | esperar segundos e repetir com a mesma chave |
| `conflict` | 409 | a ação já foi decidida | consultar o estado (3.5/3.6) |
| `validation_failed` | 422 | tipo fora do catálogo ou `params` inválidos | corrigir contra este contrato; não repetir igual |
| `rate_limited` | 429 | limite excedido | backoff exponencial a partir de `retry_after` / `Retry-After` |
| `internal_error` | 500 | erro interno | repetir com a mesma `Idempotency-Key` é seguro |

Rate limits: limites por IP e por credencial aplicam-se às rotas autenticadas
(precedente VitrinePro: 60 pedidos/min no stats), somados aos tetos de escrita
por recurso da infraestrutura de tokens.

---

## 9. Multiempresa

A integração é **por organização**, de ponta a ponta:

| Peça | Como é por empresa |
|---|---|
| Credencial | Uma por organização, emitida pelo admin dela; a organização de qualquer pedido é a da credencial |
| Agente de IA | O agente configurável da organização (`ai_agents` da própria organização) — as *capabilities* resumem o dela |
| Conhecimento | As bases de conhecimento são da organização; nada deste contrato lê conhecimento de outra |
| Conversas e leads | Isolados por `organization_id` (RLS + filtro por organização); as estatísticas são só da organização da credencial |
| Permissões | Escopos por credencial + papéis humanos por organização (decisão = admin daquela organização) |
| Histórico e auditoria | Pedidos registados no `event_log` e decisões gravadas na auditoria (`api_audit_log`), sempre filtrados por `organization_id`; nada cruza organizações |

Nenhuma destas peças tem uma variante "global": não existe credencial de
plataforma, agente partilhado nem leitura cruzada neste contrato. Servir
outra organização é repetir o processo dela — credencial dela, agente dela,
estatísticas dela.

---

## 10. O que a Athena precisa de fazer (lado do Cláudio)

O lado do NEXORA está implementado. Para a integração existir de verdade,
falta o lado da Athena — trabalho do Cláudio, no repositório da Athena, que
este documento não altera:

1. **Criar a integração na Athena Control** — uma integração `kind="api"`
   para o NEXORA CRM, apontada à base URL da instalação, no mesmo padrão das
   integrações já existentes (VitrinePro, TrendHub USA).
2. **Guardar a credencial no cofre da Control** — o admin da organização
   emite o token no NEXORA (*Configurações → Tokens de API*, com os escopos
   `athena:stats`, `athena:capabilities` e `athena:actions` conforme o uso)
   e um humano cola o plaintext — mostrado **uma única vez** na emissão —
   diretamente no cofre da Control. Nunca por chat, nunca em texto simples,
   nunca em variável partilhada entre organizações: uma credencial por
   organização.
3. **Registar `nexora_crm` em PROVIDERS** — o catálogo de providers da
   Athena passa a conhecer o NEXORA como produto consumível por este
   contrato.
4. **Sonda de verificação contra o `GET /health`** — a Control valida a
   integração chamando o health (público, JSON plano) e confirmando
   `platform`, `contract: "v1"` e `enabled: true` depois de a flag ser
   ligada na instalação; as *capabilities*, com a credencial, confirmam a
   organização certa.
5. **Ativar o adapter — só numa fase de execução autorizada.** O adapter
   `nexora_crm` já existe reservado na Athena com `ESTADO="disabled"`.
   Ligá-lo não faz parte deste contrato: solicitar ações e provar decisões
   não é executar, e qualquer fase de execução exige autorização separada,
   uma nova versão deste contrato com os estados de execução, e testes
   próprios.

Enquanto estes passos não acontecerem, a integração está implementada e
desligada — não está "meio ligada".

---

## 11. Diferenças para a preparação v1

A preparação v1 (o desenho anterior, nunca publicado em nenhum ambiente)
foi substituída por este contrato oficial. As diferenças:

- **`commands` → `actions`.** As rotas `POST /commands`,
  `GET /commands/{id}` e `POST /commands/{id}/decision` chamam-se agora
  `actions` (e a ação regista-se com `type`, não `command`). Custo zero: a
  preparação nunca esteve no ar, por isso não há consumidor para partir.
- **Escopos repartidos.** O escopo único `athena:commands` foi substituído
  por três — `athena:stats`, `athena:capabilities`, `athena:actions` — para
  uma credencial poder ler estatísticas sem poder pedir ações.
- **Health alinhado ao formato plano da Control.** O health deixou o
  envelope da casa e responde JSON plano (`platform`, `status`, `version`,
  `contract`, `capabilities`, `enabled`, `timestamp`), como os produtos que
  a Control já consome.
- **`Idempotency-Key` passa a obrigatória** em `POST /actions` (na
  preparação era opcional): sem chave ou não-UUID → `400 bad_request`.
- **Nova rota de evidência de aprovação** — `GET /actions/{id}/approval`
  (secção 3.6), que devolve a `approval_ref` e a referência do registo de
  auditoria da decisão.
- **REMOVIDOS: webhook + HMAC + `ATHENA_WEBHOOK_SECRET`.** A preparação
  tinha uma porta de webhook assinado para a Athena avisar de eventos; o
  padrão real, confirmado com os precedentes vivos, é o inverso — **a
  Athena não envia webhooks a produtos**, é ela que consome as APIs deles.
  A rota, a verificação de assinatura e a variável de ambiente saem.
- **A decisão aguarda a gravação da auditoria.** Em `POST
  /actions/{id}/decision`, o `audit()` é aguardado (`await`) em vez do
  fire-and-forget habitual: a evidência tem de existir antes de a decisão
  responder, porque é ela que a rota de approval lê.

---

## 12. Testes

A implementação é acompanhada de testes de rota (Vitest, ao lado de cada
`route.ts` em `app/api/v1/integrations/athena/`) e de testes da biblioteca
(`lib/integrations/athena/`). A lista exigida por este contrato:

- **Autenticação e escopos** — sem credencial → `401`; credencial sem o
  escopo da rota → `403` com `required_scope`; cada rota pede o seu escopo
  (`athena:stats` / `athena:capabilities` / `athena:actions`).
- **Revogação** — credencial revogada responde `401 token_invalid` no
  pedido seguinte, só na organização dela.
- **Isolamento multiempresa** — ação, estatísticas e capacidades são sempre
  da organização da credencial; uma ação de outra organização responde
  `404`, indistinto de inexistente.
- **Idempotência e replay** — mesma chave + mesmo corpo devolve a resposta
  original sem registar outra ação; mesma chave + corpo diferente → `409
  idempotency_conflict`; sem chave ou não-UUID → `400 bad_request`.
- **Aprovação e evidência** — toda a ação nasce `pending_approval`; só um
  admin com sessão decide; a decisão fica provada em `GET
  /actions/{id}/approval` com `approval_ref`, decisor, papel e referência
  de auditoria; pendente responde `approval_ref: null`.
- **Health no formato Control** — `200` sempre, JSON plano, `enabled` a
  dizer a verdade da flag, desligada ou ligada.
- **Erros** — os códigos e estados da secção 8, incluindo `429` com
  `Retry-After` no limite do stats e `404` plano com a integração
  desligada.

Os resultados reais desta implementação (quantos testes, quantos verdes)
vão no relatório da missão que a entregou — não neste documento, para o
contrato não envelhecer com números de uma fotografia. Testes ao vivo
contra uma instalação real dependem do staging: enquanto não houver deploy
autorizado, "testado" significa a suite automatizada, e nada aqui apresenta
simulação como real.
