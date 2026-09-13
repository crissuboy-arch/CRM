# Estado do projeto — NEXORA CRM

Data: 2026-09-13. Original: DeskcommCRM. Licença: MIT; copyright original preservado em LICENSE.

- Local: C:\Users\crist\OneDrive\Documentos\CRM\DeskcommCRM
- Localhost: http://localhost:3000
- Supabase existente: conta cristiane.fsopt@gmail.com; nenhum secret neste documento.
- Branch: setup/local-foundation
- Origin: https://github.com/crissuboy-arch/CRM.git
- Upstream: https://github.com/melgarafael/DeskcommCRM.git
- Commit: feat: rebrand CRM as Nexora and apply blue design system. Consultar hash com git log -1 --format=%H; o próprio commit contém este documento.

Rebranding central: NEXORA / NEXORA CRM / AI-Powered CRM; primary #2563EB, hover #1D4ED8, fundos claros e navy no tema escuro. Paleta e fontes centrais em [BRANDING.md](BRANDING.md).

Arquivos de produto: lib/branding.ts, lib/branding/regua-do-produto.ts, app/globals.css, app/layout.tsx, app/manifest.ts, app/(public)/login/page.tsx, app/design/{layout,page}.tsx, lib/email/templates/ai-budget-alarm.tsx, package.json. Mantido ajuste anterior de app/providers.tsx (React Query Devtools opt-in). Testes de branding atualizados. Documentação histórica local preservada.

Removidos do diff o login automático temporário de proxy.ts e o log de timeout de lib/api/client.ts. Autenticação normal restaurada; timeout e funcionalidades originais preservados. Nenhuma migration, baseline ou alteração de Supabase executada nesta etapa.

Validação: 38 testes pontuais de branding aprovados; lint dos arquivos de produto alterados aprovado. Next iniciou na porta 3000. Login e manifest responderam 200 com NEXORA e tagline, sem DeskcommCRM; favicon respondeu 200. Rotas protegidas redirecionam para login sem sessão. Next build --experimental-build-mode compile concluiu com exit 0, incluindo coleta das rotas. Build completo para deploy nao foi executado. Typecheck e suíte completa não foram repetidos.

Limite: ferramenta sem navegador nesta sessão. Sidebar, navegação autenticada, CRM e Meta Ads dependem de confirmação visual do usuário; a navegação anterior foi confirmada por ele antes do rebranding. HTTP 307 não comprova tela autenticada.

Problema conhecido anterior: Supabase retornou email_provider_disabled. Se persistir, login por senha continuará indisponível; bypass local removido e configuração de Auth preservada. Timeouts intermitentes de contatos/canais não foram investigados novamente.

Segurança: .env*, logs, scripts temporários e artefatos SQL locais ignorados e mantidos no disco. Nenhum SQL reaplicado ou incluído no commit. Verificação de segredos antes da publicação; nenhum valor de credencial documentado.

WhatsApp/WAHA, Meta Ads, IA, Google Calendar e demais integrações não foram configurados nesta etapa. Acesso às telas não comprova conexão externa. Workflows, imagens e links técnicos de atualização continuam upstream; push não configura VPS ou imagem própria.

Performance deve ser avaliada novamente em build de produção/VPS. Development no Windows compila páginas sob demanda; sem profiling ou otimização ampla.

Primary entregue pelo CSS de runtime no login: #2563eb, confirmado por HTTP. Verificação de 3.935 arquivos selecionados não encontrou valores de secrets locais, arquivos .env reais rastreados ou os padrões de credenciais verificados. LICENSE sem alteração.

Próximo passo: confirmar navegação autenticada com a identidade NEXORA.

Publicação: PUSH BLOQUEADO pela revisão automática de aprovação. A revisão não reconheceu autorização explícita para publicar o código/documentação no destino origin indicado no pedido anexado. Nenhum push realizado. Aguarda confirmação direta do usuário para publicar a branch setup/local-foundation em https://github.com/crissuboy-arch/CRM.git. Git configurado somente neste repositório com autor crissuboy-arch e e-mail noreply do GitHub.
