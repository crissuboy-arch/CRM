# NEXORA CRM — Branding

Atualizado em 2026-09-13.

| Identidade | Valor |
| --- | --- |
| BRAND | NEXORA |
| PRODUCT | NEXORA CRM |
| TAGLINE | AI-Powered CRM |
| PRIMARY | #2563EB |
| PRIMARY DARK | #1D4ED8 |
| NAVY | #0F172A |
| DARK NAVY | #0A0F1C |
| SECONDARY NAVY | #122038 |
| LIGHT BLUE | #EFF6FF |
| WHITE | #FFFFFF |
| LIGHT BACKGROUND | #F8FAFC |
| TEXT | #0F172A |

Nome, nome completo e descrição: lib/branding.ts, constantes DEFAULT_APP_NAME, APP_FULL_NAME e APP_DESCRIPTION. O resolvedor apresenta nomes legados Deskcomm/DeskcommCRM/Deskcomm CRM como NEXORA, sem escrever no banco. Outras marcas explicitamente configuradas continuam respeitadas.

Cores: app/globals.css, tokens --color-accent-*, superfícies e texto. Primary, links, focus, botões e estados selecionados usam os aliases existentes. No tema escuro, tons mais claros da rampa preservam leitura. Verde de sucesso/conexão, vermelho de erro, amarelo de alerta e cores individuais da Agenda permanecem preservados.

Espelho de runtime: lib/branding/regua-do-produto.ts, gerado por extrairRegua() de lib/branding/contraste.ts. O teste branding-regua-do-produto.test.ts verifica sincronização com o CSS. O motor existente ainda respeita cores específicas configuradas na instalação/organização e calcula contraste.

Metadata e manifest usam a descrição central. O favicon dinâmico (app/icon.tsx) deriva a inicial N e a cor pelo mesmo resolvedor; nenhum pacote ou imagem externa foi adicionado. E-mails ativos continuam usando marcaDaSaida(); o template legado sem chamador usa o nome padrão central.

Identificadores técnicos, cookies, APIs, SQL e infraestrutura upstream permanecem compatíveis. Licença MIT e copyright original em LICENSE preservados. NEXORA é a marca comercial desta instalação, baseada em DeskcommCRM.
