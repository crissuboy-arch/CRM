# Instalação local — 2026-09-10

Estado desta sessão na branch `setup/local-foundation`. Preservar funcionalidades,
marca e idiomas. Sem push, conexão a serviços remotos ou uso de credenciais reais.

## Estratégia de banco

Banco novo deve receber exclusivamente `supabase/baseline.sql`. Não executar
`supabase db reset`, `supabase db push` nem a cadeia de migrations históricas.
Os testes de banco usam Postgres descartável e o baseline; não são o Supabase do usuário.

## Portas WAHA (confirmado nos arquivos)

| Caminho | Endereço |
| --- | --- |
| Next no host, comando padrão | `http://localhost:3000` |
| WAHA acessado pelo host | `http://localhost:3030` |
| WAHA acessado pelo worker Docker | `http://waha:3000` |
| Webhook padrão do compose | `http://host.docker.internal:3003/api/v1/webhooks/waha` |

Há duas inconsistências: `.env.example` aponta o cliente WAHA para 3000,
mas o compose publica 3030; o comentário do webhook menciona 3002,
mas o valor efetivo é 3003. Não são três portas alternativas para o WAHA.

Solução local sem alterar defaults de instalações existentes: iniciar Next com
`corepack pnpm dev --hostname 127.0.0.1 --port 3003` e configurar futuramente
`NEXT_PUBLIC_APP_URL=http://localhost:3003` e
`WAHA_API_BASE_URL=http://localhost:3030` em `.env.local`.
O worker mantém seu override `http://waha:3000`.
O compose não carrega `.env.local` para interpolação automaticamente: usar
`docker compose --env-file .env.local ...` quando a integração for configurada.
Não iniciar WAHA/worker sem preparar autenticação e segredos locais.

## Valores que serão necessários (não enviar no chat)

Criar `DeskcommCRM/.env.local` a partir de `.env.example` somente na etapa de
configuração. Preencher:

- `NEXT_PUBLIC_SUPABASE_URL`: Project URL do projeto Supabase.
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`: chave legada `anon` do mesmo projeto.
- `SUPABASE_SERVICE_ROLE_KEY`: chave legada `service_role`, somente no servidor.
- `SUPABASE_DB_URL`: URI PostgreSQL do projeto para baseline e worker;
  incluir a senha do banco, com caracteres especiais codificados na URI.

No painel Supabase, buscar URL em Connect / Project URL e chaves em Settings >
API Keys > Legacy API Keys. Buscar URI em Connect > Connection String;
preferir conexão direta se IPv6 estiver disponível, ou Session pooler para
conectividade IPv4. A senha é a senha do banco definida na criação do projeto
(não a senha de login no painel). Não gravar valores em documentação ou Git.

## Validação

Em andamento. Docker Desktop 4.57.0 / Engine 29.1.3 confirmado em execução;
Node 22.22.0. Corepack requer acesso ao cache fora do sandbox. O download
exigiu `NODE_USE_SYSTEM_CA=1` para confiar nos certificados do Windows;
validação TLS permaneceu ativa. Instalação usa pnpm 9.15.9 e lockfile congelado.

Resultados já confirmados:

- Instalação: exit 0, 911 pacotes; lockfile preservado.
- Typecheck: exit 0 com `NODE_OPTIONS=--max-old-space-size=8192` somente no processo.
  A tentativa inicial esgotou o heap padrão do Node (exit 134).
- ESLint, `lint:channels` e `lint:role-rank`: concluídos sem apontamentos novos.
- Baseline em `pgvector/pgvector:pg15`: install e update aprovados com
  `ON_ERROR_STOP=1`; zero erro na reaplicação. Isso não equivale à suíte de invariantes.
- Diagnóstico Vitest: 13/13 testes em `baseline-no-piso-do-postgres.test.ts`,
  com `--pool=threads --maxWorkers=1`. Isso não equivale à suíte unitária completa.
- Shell: exit 1 na prova de permissão Unix `.env continua 600` em Git Bash/Windows.
  O encadeamento `&&` não executou as suítes seguintes após essa falha.
- Build: compilação concluída; resultado final ainda em verificação.
- Suíte unitária completa e invariantes: em verificação. Execuções anteriores
  foram interrompidas por pressão de recursos; não são resultados aprovados.

Logs locais completos ficam na pasta pai do repositório, `CRM/local-*.log`.
Não foram adicionados ao Git. A máquina reportou aproximadamente 7 GB de RAM,
com menos de 0,5 GB livre durante a carga simultânea.

Referências oficiais para obter os valores sem compartilhá-los no chat:
[chaves de API](https://supabase.com/docs/guides/getting-started/api-keys) e
[conexão PostgreSQL](https://supabase.com/docs/guides/database/connecting-to-postgres).

## 2026-09-11 — retomada e diagnóstico

- O log do build chegou à listagem final de rotas e legenda de renderização.
  O código de saída da sessão original não foi recuperado.
- A suíte de invariantes terminou: 182 arquivos aprovados e 3 reprovados;
  1463 testes aprovados, 7 reprovados, 1 falha esperada e 1 ignorado.
  Quatro falhas são timeouts de 30 segundos (webhooks-inbound e
  on-conflict-aponta-para-constraint-real); três são asserções em agenda-meet.
  As causas destas sete falhas ainda não foram confirmadas.
- A suíte unitária anterior não tem resumo final no log: continua inconclusiva.
- Reproduzidas duas falhas em performed-at-um-relogio-so e tarefa-prazo-e-faixa
  com pool de threads. Repetição com `--pool=forks --maxWorkers=1` e
  `C:\Program Files\Git\usr\bin` no PATH: **10/10 testes aprovados, exit 0**.
  O primeiro depende de grep; o segundo altera TZ em execução. Não houve
  alteração de código para obter este resultado.
- Os logs individuais de dono-do-projeto, owner-id-por-email e
  scheduler-entrypoint terminam aprovados. test-validators termina reprovado:
  não encontrou o aviso de build local quando as imagens estão inalcançáveis.
- Próximos gates: diagnóstico dos PDFs, suíte unitária completa com processos
  isolados e reexecução dirigida dos invariantes reprovados. A configuração
  dos serviços permanece pendente; não foram usadas credenciais reais.
