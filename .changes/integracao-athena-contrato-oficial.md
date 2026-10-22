---
impacto: capacidade_nova
secao: adicionado
---

**Integração Athena — contrato oficial (continua desligada por omissão).** Para quem opera o CRM sem ligar a integração, nada muda: sem `ATHENA_INTEGRATION_ENABLED=true`, os endpoints da Athena respondem como se não existissem e nenhuma tela, fluxo ou dado é afetado. Com a flag ligada e um token de API com os escopos `athena:*` (`athena:stats`, `athena:capabilities`, `athena:actions`), a Athena passa a poder consultar a saúde da instalação, as estatísticas agregadas e as capacidades da organização do token, e **pedir** ações — que nascem sempre pendentes de aprovação humana: só uma pessoa administradora, com sessão iniciada, aprova ou rejeita, e a decisão fica provada por uma referência de auditoria que a Athena pode verificar. Pedir não executa nada. A porta de webhook da preparação anterior foi removida: a Athena não envia avisos ao CRM — é ela que consome esta API. Contrato completo em `docs/integracao/athena.md`.
