---
impacto: capacidade_nova
secao: adicionado
---

**Preparação da integração Athena (desligada por omissão).** O CRM passa a ter o contrato v1 para a Athena pedir ações sem executar nada sozinha: os comandos que ela enviar pela API criam pedidos pendentes de aprovação humana e só uma pessoa administradora, com sessão iniciada, pode aprovar ou rejeitar — o token da Athena nunca aprova o próprio pedido. Nesta fase a aprovação apenas regista a decisão; nenhuma ação é executada automaticamente. A integração só responde com `ATHENA_INTEGRATION_ENABLED=true` e um token de API com o escopo `athena:commands`, e os avisos da Athena chegam por webhook com assinatura HMAC verificada. Contrato completo em `docs/integracao/athena.md`.
