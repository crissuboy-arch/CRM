/**
 * Contrato v1 da integração Athena — os esquemas Zod são a forma executável
 * do contrato oficial (`ATHENA_NEXORA_INTEGRATION_CONTRACT.md`). Mudou
 * aqui, muda lá.
 *
 * Princípio que atravessa tudo: NENHUMA ação executa quando chega. Cada
 * uma vira um pedido em `pending_approval` e só uma pessoa com sessão
 * (admin da organização) o pode aprovar ou rejeitar. Nesta fase nem a
 * aprovação executa coisa alguma — ela regista a decisão; o executor é
 * uma fase futura, com autorização própria.
 *
 * A v1 de preparação chamava a isto "commands"; o contrato oficial chama
 * "actions". A renomeação tem custo zero — a v1 nunca esteve no ar — e os
 * nomes antigos saem já, para não ficarem dois vocabulários a competir.
 */
import { z } from "zod";

/**
 * O catálogo de ações que a Athena pode PEDIR. É fechado de propósito:
 * tipo fora da lista é `422`, não é "desconhecido mas aceite". Acrescentar
 * um tipo é mudar o contrato (e este ficheiro, e o documento).
 *
 * Todas são sensíveis por desenho — mexem em clientes, mensagens ou
 * agendamento — e por isso todas passam pela aprovação humana.
 */
export const ACOES_ATHENA = [
  "contacts.create",
  "messages.send",
  "appointments.create",
  "reports.generate",
] as const;

export type AcaoAthena = (typeof ACOES_ATHENA)[number];

export const acaoAthenaSchema = z.object({
  type: z.enum(ACOES_ATHENA),
  params: z.record(z.string(), z.unknown()).default({}),
  /** Por que a Athena está a pedir isto — vai para o pedido, ajuda quem aprova. */
  reason: z.string().trim().max(500).optional(),
});

export type AcaoAthenaInput = z.infer<typeof acaoAthenaSchema>;

/** A decisão humana sobre uma ação — só chega por sessão, nunca por token. */
export const decisaoAthenaSchema = z.object({
  decision: z.enum(["approve", "reject"]),
  note: z.string().trim().max(500).optional(),
});

export type DecisaoAthenaInput = z.infer<typeof decisaoAthenaSchema>;

/** Os estados de uma ação, na ordem em que podem acontecer. */
export const ESTADOS_DA_ACAO_ATHENA = ["pending_approval", "approved", "rejected"] as const;

export type EstadoDaAcaoAthena = (typeof ESTADOS_DA_ACAO_ATHENA)[number];
