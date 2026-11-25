# Sync NEXORA ↔ DeskcommCRM — 25/11/2026

Branch: `chore/sync-deskcomm-upstream-2026-11-25` · PR #9 (base `feat/athena-contract-v2`)
Upstream: `melgarafael/DeskcommCRM`, `main` @ `c71aaab35` (PR #5245). Base do merge NEXORA: release 1.86.0.

## O que foi integrado

- **4.655 commits** do upstream desde o sync de 04/11 (7.878 desde a base do merge).
- **6.984 ficheiros alterados** (+1.083.120/−47.760 linhas).
- **252 migrations novas** (145 desde 04/11; as outras 107 são as do sync de 04/11, que nunca tinham entrado na linha de staging). Total: 777 ficheiros em `supabase/migrations/`. **NENHUMA migration foi aplicada** — só ficheiros.
- **14 conflitos resolvidos**, sempre a preservar o lado NEXORA (rebrand + contrato Athena v2 intacto, zero alterações em `app/api/v1/integrations/athena`, `lib/integrations/athena` e `docs/integracao/athena.md`).
- 2 correções durante a validação: login passa a usar `marcaDaSaida(null)` (nome da marca vem do banco) e re-selo das traduções white-label.

## Validação

- `pnpm install --frozen-lockfile`: PASS. Testes dirigidos (Athena, branding, marcadores, auditoria, i18n): 82/83 PASS (1 timeout da VM). Marca/traduções: 17/17 PASS. ESLint/lints: PASS.
- **CI do PR #9: VERMELHO** — `verify` e os builds Docker morrem no typecheck com `JavaScript heap out of memory` (exit 134). Não é erro de código: a base `c6ed50243` passa o typecheck com heap de 5 GB; o código com o sync já não cabe no heap. O preview Vercel ficou **Ready** (a Vercel tem mais memória e constrói o código).
- `invariants`: falha pré-existente e ambiental — o repo não é fork no GitHub e não tem releases publicadas, por isso a verificação de release falha antes dos testes.
- **NÃO VERIFICADOS**: typecheck completo, build e `test:unit` completo nesta VM (falta de memória/lentidão); `test:db`/`test:e2e` (precisam de Docker); fluxos autenticados ao vivo.

## Correção do heap — por enviar

Commit local `70517b913` (ainda NÃO está no GitHub): `NODE_OPTIONS: --max-old-space-size=6144` no Typecheck do `ci.yml` e `NODE_HEAP_MB=6144` nos build-args da imagem do app no `publish-image.yml` (o upstream resolveu igual: 8192 no typecheck).

**O push está bloqueado**: o token `gh` desta máquina não tem o scope `workflow` e o GitHub recusa enviar alterações a ficheiros de workflow. Desbloqueio: `gh auth refresh -s workflow` com a Cristiane a introduzir o código de dispositivo em github.com/login/device (dois códigos expiraram por não serem usados: `5D58-C40A` e `3100-4F59`).

## Instalação na VPS

O kit de instalação do upstream veio no sync: `hostgator-setup-kit/install.sh` (mesmo guia do autor — VPS com Docker, Supabase, chave de IA, domínio).

**Atenção — a VPS não constrói a imagem.** Por lei do repo (`docs/doctrine/packaging.md`), a instalação usa imagens **publicadas pelo CI** (`docker compose pull` + `up -d`); nenhum serviço constrói na máquina do cliente. Ora o build da imagem do app no CI está a falhar por falta de memória (ver acima) — por isso **ainda não existe imagem publicada com o código do sync**. Quem instalar agora fica com a última imagem publicada (código anterior ao sync).

Depois de a correção do heap ser enviada e o CI ficar verde, o CI publica a imagem nova; aí a instalação/atualização (`update.sh`) passa a trazer o código do sync.

Instalar a partir desta branch (`chore/sync-deskcomm-upstream-2026-11-25`), não da linha de staging (`feat/athena-contract-v2` @ `c6ed50243`, que ainda tem o código anterior ao sync).

## O que falta

1. Enviar a correção do heap (precisa da autorização dela, ver acima) → CI corre de novo.
2. Merge do PR #9 só com o CI verde (ou com decisão dela se só falharem os testes conhecidos).
3. Deploy do staging + verificação ao vivo (site abre, `/health` 200).
4. Aplicar as 252 migrations — etapa separada, com go dela.
5. Testar os fluxos autenticados ao vivo (nunca verificados).
