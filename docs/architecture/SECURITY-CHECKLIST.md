# Checklist de Segurança — Integração Instagram/Meta

> Checklist de arquitetura e aceite. Itens marcados somente durante a implementação com evidência.

## 1. OAuth state e redirect

- [ ] State possui nonce criptograficamente aleatório, organização, usuário iniciador, redirect permitido, emissão e expiração.
- [ ] Nonce é persistido server-side, single-use e consumido atomicamente.
- [ ] State é comparado em tempo constante quando houver assinatura.
- [ ] Expiração curta (ordem de minutos) e rejeição de clock/estrutura inválida.
- [ ] Callback exige usuário Supabase autenticado e membership ativo na mesma organização.
- [ ] Papel mínimo para conectar/desconectar canal é definido e aplicado por `requireRole()`.
- [ ] `redirect_uri` é derivado de base URL confiável; não vem livremente de query/body.
- [ ] Redirecionamento pós-callback usa allowlist/safe-next; nunca URL arbitrária.
- [ ] Erros visíveis ao usuário usam códigos, sem incluir resposta sensível da Meta.

Observação: o state assinado e expirável do OpenReply é útil, mas contém apenas workspace/timestamp e pode ser reutilizado dentro da janela. O alvo NEXORA deve usar nonce persistente de uso único.

## 2. Access tokens e secrets

- [ ] `INSTAGRAM_APP_SECRET`/`META_APP_SECRET` apenas no servidor.
- [ ] Access/refresh tokens nunca entram em `NEXT_PUBLIC_*`, HTML, RSC serializado ou resposta API.
- [ ] Tokens são cifrados pela infraestrutura canônica `fn_encrypt_oauth`/`fn_decrypt_oauth`.
- [ ] RLS ligada e grants de `anon`/`authenticated` revogados nas tabelas de credenciais.
- [ ] Apenas service role chama RPC de cifra/decifra.
- [ ] Ausência da chave mestre falha fechada; nunca cai para plaintext.
- [ ] Logs/Sentry removem Authorization, tokens, codes OAuth e URLs assinadas.
- [ ] Rotação de segredo/chave e reconexão da conta têm runbook.
- [ ] Desconectar revoga assinatura/token remotamente quando suportado e limpa credencial local com auditoria.

## 3. Webhook verification

- [ ] GET challenge confere `hub.mode`, verify token em tempo constante e presença do challenge.
- [ ] POST lê raw body antes do parse.
- [ ] `x-hub-signature-256` é obrigatório e validado HMAC-SHA256 com tamanho conferido antes de `timingSafeEqual`.
- [ ] Falta de secret/configuração rejeita o webhook; não aceita unsigned.
- [ ] Assinatura inválida retorna 401/403 sem persistir body/preview com PII.
- [ ] Payload validado por Zod/envelope versionado após assinatura.
- [ ] Tamanho máximo de body aplicado antes de persistir/processar.
- [ ] Apenas campos necessários de headers são arquivados; cookies e authorization são removidos.
- [ ] Resposta 2xx ocorre após persistência/idempotência durável, não após todos os side effects.

## 4. Isolamento de organização

- [ ] Toda tabela nova tenant-aware tem `organization_id not null` e RLS.
- [ ] FKs compostas impedem ligar contato/sessão/regra de organizações diferentes.
- [ ] Webhook resolve organização por path token/sessão/conta confiável, nunca por payload declarado.
- [ ] OAuth callback valida membership da organização contida no state.
- [ ] Toda query com service role filtra `organization_id` explicitamente.
- [ ] Teste real com duas organizações tenta ler, atualizar, acionar regra e enviar usando IDs cruzados.
- [ ] IDs externos iguais em organizações diferentes não causam seleção ambígua.

## 5. Rate limiting

- [ ] Limites separados por operação: private reply, public comment reply, DM normal, leitura/sync e endpoints públicos.
- [ ] Bucket inclui conta Instagram; onde necessário inclui app/organização.
- [ ] Reserva é atômica antes do envio.
- [ ] Limite/configuração é atualizável sem deploy; não congelar 750/h como contrato eterno.
- [ ] Resposta 429/headers Meta alimentam backoff dinâmico.
- [ ] Retry respeita `Retry-After` e jitter.
- [ ] Fallback em memória é proibido em produção multi-instância para limite crítico.
- [ ] Webhook/OAuth/connect/redirect público também tem rate limit anti-abuso.

## 6. Idempotência, retries e duplicação

- [ ] Webhook replay não cria segundo contato, conversa, mensagem, lead ou execução.
- [ ] Side effect externo reserva chave durável antes da chamada.
- [ ] DM e resposta pública possuem chaves/estados independentes.
- [ ] Erros Meta são classificados: retryable, permanent, auth, policy, rate-limit e uncertain.
- [ ] Falha de rede após envio vira `uncertain`; não reenvia cegamente.
- [ ] Job usa lease/claim e pode ser retomado após crash.
- [ ] Backoff é limitado, com dead-letter/central operacional depois do máximo.
- [ ] Poda de `event_log`/fila não elimina o ledger de deduplicação antes da janela segura.
- [ ] Reconciliação não dispara novamente evento já entregue.
- [ ] Follow-up cancelado/opt-out nunca revive por retry atrasado.

## 7. Mensageria e privacidade

- [ ] Janela de mensagens e permissões Meta verificadas no before-send.
- [ ] Opt-out NEXORA é executado antes de lead/automação/IA.
- [ ] `contacts.is_blocked` veta DM, campanha e follow-up.
- [ ] Conteúdo, IDs e métricas têm política de retenção/LGPD.
- [ ] IP de click é hasheado com sal rotativo; IP bruto não é armazenado.
- [ ] URLs de destino são `https`, validadas e protegidas contra open redirect/SSRF.
- [ ] Conteúdo de usuário não é colocado em logs de erro/diagnóstico.
- [ ] Mídia usa Storage privado e URLs assinadas, não URLs efêmeras persistidas.

## 8. Autorização de produto

- [ ] Viewer não conecta conta, cria regra nem envia.
- [ ] Agent pode responder apenas segundo política definida.
- [ ] Manager/admin gerencia conexão e automação conforme RBAC.
- [ ] Mudanças de regra, conexão, token, envio manual e retry geram audit log.
- [ ] Impersonation/suporte respeita controles e rastreabilidade existentes.
- [ ] Relatórios públicos permanecem desativados até threat model específico.

## 9. Supply chain e licença

- [ ] Não adicionar dependências BullMQ/ioredis/Prisma/Auth.js sem ADR explícito (desenho atual não precisa).
- [ ] Versões e advisories das dependências portadas são verificados.
- [ ] Código derivado do OpenReply mantém copyright de Anish Raj e Diwen Huang e texto MIT.
- [ ] Código NEXORA preserva copyright de Rafael Melgaço e texto MIT.
- [ ] Arquivo NOTICE/THIRD_PARTY_NOTICES identifica arquivos derivados e origem/commit.
- [ ] NEXORA não declara autoria original de código portado.

## 10. Evidência mínima para produção

- [ ] Testes unitários dos parsers com fixtures assinadas/sanitizadas.
- [ ] Testes de OAuth state: replay, expiry, wrong org/user e redirect externo.
- [ ] Testes DB de RLS e FKs compostas com duas organizações.
- [ ] Testes de concorrência de idempotência/rate limit.
- [ ] E2E visual: conectar conta, receber DM, responder na Inbox, comentário→DM e opt-out.
- [ ] Teste de crash/restart do worker sem envio duplicado.
- [ ] Teste de token expirado/revogado e alerta operacional.
- [ ] Teste de assinatura ausente/incorreta e payload gigante.
- [ ] Runbook de revogação, rotação, DLQ e reconciliação.
