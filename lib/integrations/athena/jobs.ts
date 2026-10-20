/**
 * O registo de jobs da Athena mora no `event_log` — a fila canónica do
 * produto — sem tabela nova e sem migration:
 *
 * - Criar um job é emitir o evento `athena.command_received`
 *   (`entity_kind = "athena_command"`, `entity_id = job_id`) pela RPC
 *   `emit_event`, com o estado no `payload.state`.
 * - O estado de aprovação (`pending_approval` → `approved` | `rejected`)
 *   vive no payload; o `status` do `event_log` fica `pending`, que é a
 *   verdade: nenhum handler está registado para este tipo de evento, por
 *   isso o drain ignora-o — nada executa sozinho.
 * - Ler e decidir filtram SEMPRE por `organization_id` resolvida por quem
 *   chama (token ou sessão, nunca do pedido): um job de outra organização
 *   é indistinguível de um job que não existe.
 *
 * A decisão usa compare-and-swap sobre o payload inteiro: o UPDATE só
 * acerta se o payload ainda for exatamente o que foi lido. Duas decisões
 * simultâneas não passam as duas — a segunda encontra o payload mudado,
 * atualiza zero linhas e é recusada como `already_decided`.
 */
import { randomUUID } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { EstadoDoJobAthena } from "./contrato";

export const EVENTO_COMANDO_ATHENA = "athena.command_received";
export const EVENTO_WEBHOOK_ATHENA = "athena.webhook_received";
export const ENTIDADE_COMANDO_ATHENA = "athena_command";
export const ENTIDADE_WEBHOOK_ATHENA = "athena_webhook";

export interface JobAthena {
  job_id: string;
  organization_id: string;
  command: string;
  state: EstadoDoJobAthena;
  /** O `status` cru do event_log (o pipeline de eventos, não a aprovação). */
  event_status: string;
  reason: string | null;
  created_at: string;
  decided_by: string | null;
  decided_at: string | null;
}

interface LinhaDoJob {
  id: string;
  organization_id: string;
  payload: Record<string, unknown>;
  status: string;
  created_at: string;
}

function comoPayload(valor: unknown): Record<string, unknown> {
  return valor !== null && typeof valor === "object" && !Array.isArray(valor)
    ? (valor as Record<string, unknown>)
    : {};
}

function comoEstado(valor: unknown): EstadoDoJobAthena {
  return valor === "approved" || valor === "rejected" ? valor : "pending_approval";
}

function paraJob(linha: LinhaDoJob, jobId: string): JobAthena {
  const p = linha.payload;
  return {
    job_id: jobId,
    organization_id: linha.organization_id,
    command: typeof p.command === "string" ? p.command : "",
    state: comoEstado(p.state),
    event_status: linha.status,
    reason: typeof p.reason === "string" ? p.reason : null,
    created_at: linha.created_at,
    decided_by: typeof p.decided_by === "string" ? p.decided_by : null,
    decided_at: typeof p.decided_at === "string" ? p.decided_at : null,
  };
}

/** Cria o job (pendente de aprovação) e devolve o seu id. Lança em falha. */
export async function criarJobAthena(
  db: SupabaseClient,
  entrada: {
    organizationId: string;
    command: string;
    params: Record<string, unknown>;
    reason?: string;
    apiTokenId?: string;
  },
): Promise<string> {
  const jobId = randomUUID();
  const { error } = await db.rpc("emit_event", {
    p_event_type: EVENTO_COMANDO_ATHENA,
    p_entity_kind: ENTIDADE_COMANDO_ATHENA,
    p_entity_id: jobId,
    p_payload: {
      command: entrada.command,
      params: entrada.params,
      reason: entrada.reason ?? null,
      state: "pending_approval" satisfies EstadoDoJobAthena,
    },
    p_metadata: { source: "athena-integration", api_token_id: entrada.apiTokenId ?? null },
    p_organization_id: entrada.organizationId,
  });
  if (error) throw new Error(`emit_event falhou: ${error.message}`);
  return jobId;
}

/** Regista um webhook de entrada como evento. Devolve o id do evento. */
export async function registarWebhookAthena(
  db: SupabaseClient,
  entrada: {
    organizationId: string;
    event: string;
    data: Record<string, unknown>;
    apiTokenId?: string;
  },
): Promise<string> {
  const eventId = randomUUID();
  const { error } = await db.rpc("emit_event", {
    p_event_type: EVENTO_WEBHOOK_ATHENA,
    p_entity_kind: ENTIDADE_WEBHOOK_ATHENA,
    p_entity_id: eventId,
    p_payload: { event: entrada.event, data: entrada.data },
    p_metadata: { source: "athena-integration", api_token_id: entrada.apiTokenId ?? null },
    p_organization_id: entrada.organizationId,
  });
  if (error) throw new Error(`emit_event falhou: ${error.message}`);
  return eventId;
}

async function lerLinhaDoJob(
  db: SupabaseClient,
  organizationId: string,
  jobId: string,
): Promise<LinhaDoJob | null> {
  const { data, error } = await db
    .from("event_log")
    .select("id, organization_id, payload, status, created_at")
    .eq("organization_id", organizationId)
    .eq("entity_kind", ENTIDADE_COMANDO_ATHENA)
    .eq("entity_id", jobId)
    .maybeSingle();
  if (error) throw new Error(`ler job falhou: ${error.message}`);
  if (!data) return null;
  return { ...data, payload: comoPayload(data.payload) } as LinhaDoJob;
}

/** Lê um job da organização. De outra organização (ou inexistente): `null`. */
export async function lerJobAthena(
  db: SupabaseClient,
  entrada: { organizationId: string; jobId: string },
): Promise<JobAthena | null> {
  const linha = await lerLinhaDoJob(db, entrada.organizationId, entrada.jobId);
  return linha ? paraJob(linha, entrada.jobId) : null;
}

export type DesfechoDaDecisao =
  | { tipo: "decidido"; job: JobAthena }
  | { tipo: "not_found" }
  | { tipo: "already_decided"; job: JobAthena };

/**
 * A decisão humana. Só transita a partir de `pending_approval`; decidir
 * duas vezes (ou um job alheio) nunca executa nada nem finge sucesso.
 */
export async function decidirJobAthena(
  db: SupabaseClient,
  entrada: {
    organizationId: string;
    jobId: string;
    decision: "approve" | "reject";
    decidedByUserId: string;
    note?: string;
  },
): Promise<DesfechoDaDecisao> {
  const linha = await lerLinhaDoJob(db, entrada.organizationId, entrada.jobId);
  if (!linha) return { tipo: "not_found" };

  const atual = paraJob(linha, entrada.jobId);
  if (atual.state !== "pending_approval") return { tipo: "already_decided", job: atual };

  const novoEstado: EstadoDoJobAthena = entrada.decision === "approve" ? "approved" : "rejected";
  const novoPayload = {
    ...linha.payload,
    state: novoEstado,
    decided_by: entrada.decidedByUserId,
    decided_at: new Date().toISOString(),
    decision_note: entrada.note ?? null,
  };

  const { data, error } = await db
    .from("event_log")
    .update({ payload: novoPayload })
    .eq("id", linha.id)
    .eq("organization_id", entrada.organizationId)
    .eq("payload", linha.payload)
    .select("id");
  if (error) throw new Error(`decidir job falhou: ${error.message}`);
  if (!data || data.length === 0) {
    // Alguém decidiu entre a leitura e a escrita — relê e reporta o estado real.
    const relido = await lerJobAthena(db, entrada);
    return relido ? { tipo: "already_decided", job: relido } : { tipo: "not_found" };
  }
  return { tipo: "decidido", job: { ...atual, state: novoEstado, decided_by: entrada.decidedByUserId, decided_at: novoPayload.decided_at } };
}
