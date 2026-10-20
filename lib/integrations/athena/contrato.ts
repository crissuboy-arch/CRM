/**
 * Contrato v1 da integração Athena — os esquemas Zod são a forma executável
 * do documento em `docs/integracao/athena.md`. Mudou aqui, muda lá.
 *
 * Princípio que atravessa tudo: NENHUM comando executa quando chega. Cada
 * um vira um job em `pending_approval` e só uma pessoa com sessão (admin
 * da organização) o pode aprovar ou rejeitar. Nesta fase nem a aprovação
 * executa coisa alguma — ela regista a decisão; o executor é uma fase
 * futura, com autorização própria.
 */
import { z } from "zod";

/**
 * O catálogo de comandos que a Athena pode PEDIR. É fechado de propósito:
 * comando fora da lista é `422`, não é "desconhecido mas aceite". Acrescentar
 * um comando é mudar o contrato (e este ficheiro, e o documento).
 *
 * Todos são sensíveis por desenho — mexem em clientes, mensagens ou
 * agendamento — e por isso todos passam pela aprovação humana.
 */
export const COMANDOS_ATHENA = [
  "contacts.create",
  "messages.send",
  "appointments.create",
  "reports.generate",
] as const;

export type ComandoAthena = (typeof COMANDOS_ATHENA)[number];

export const comandoAthenaSchema = z.object({
  command: z.enum(COMANDOS_ATHENA),
  params: z.record(z.string(), z.unknown()).default({}),
  /** Por que a Athena está a pedir isto — vai para o job, ajuda quem aprova. */
  reason: z.string().trim().max(500).optional(),
});

export type ComandoAthenaInput = z.infer<typeof comandoAthenaSchema>;

/** Webhook de entrada: a Athena avisa que algo aconteceu do lado dela. */
export const webhookAthenaSchema = z.object({
  /** Nome do evento no vocabulário da Athena (ex.: `mission.completed`). */
  event: z.string().trim().min(1).max(120),
  data: z.record(z.string(), z.unknown()).default({}),
});

export type WebhookAthenaInput = z.infer<typeof webhookAthenaSchema>;

/** A decisão humana sobre um job — só chega por sessão, nunca por token. */
export const decisaoAthenaSchema = z.object({
  decision: z.enum(["approve", "reject"]),
  note: z.string().trim().max(500).optional(),
});

export type DecisaoAthenaInput = z.infer<typeof decisaoAthenaSchema>;

/** Os estados de um job, na ordem em que podem acontecer. */
export const ESTADOS_DO_JOB_ATHENA = ["pending_approval", "approved", "rejected"] as const;

export type EstadoDoJobAthena = (typeof ESTADOS_DO_JOB_ATHENA)[number];
