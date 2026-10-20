/**
 * Integração Athena (preparação) — as provas da biblioteca:
 *
 *  - a assinatura HMAC é fail-closed (sem cabeçalho, sem segredo ou corpo
 *    adulterado é sempre inválida);
 *  - a flag é desligada por omissão e o segredo curto não liga o webhook;
 *  - o job nasce `pending_approval`, só transita por decisão, decidir duas
 *    vezes é recusado, e um job de outra organização é invisível — o
 *    isolamento e o gate de aprovação vivem AQUI, na camada de dados,
 *    antes de qualquer rota.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { assinaturaAthena, assinaturaAthenaValida } from "./assinatura";
import { criarJobAthena, decidirJobAthena, lerJobAthena, registarWebhookAthena } from "./jobs";

const SEGREDO = "s".repeat(40);
const CORPO = JSON.stringify({ event: "mission.completed", data: { id: "m1" } });

describe("assinaturaAthenaValida — fail-closed", () => {
  it("aceita a assinatura correta, com e sem o prefixo sha256=", () => {
    const sig = assinaturaAthena(CORPO, SEGREDO);
    expect(assinaturaAthenaValida(CORPO, sig, SEGREDO)).toBe(true);
    expect(assinaturaAthenaValida(CORPO, `sha256=${sig}`, SEGREDO)).toBe(true);
  });

  it("recusa corpo adulterado depois de assinar", () => {
    const sig = assinaturaAthena(CORPO, SEGREDO);
    expect(assinaturaAthenaValida(`${CORPO} `, sig, SEGREDO)).toBe(false);
  });

  it("recusa assinatura de outro segredo", () => {
    const sig = assinaturaAthena(CORPO, "outro-segredo-comprido-1234567890");
    expect(assinaturaAthenaValida(CORPO, sig, SEGREDO)).toBe(false);
  });

  it("recusa sem cabeçalho, sem segredo ou cabeçalho vazio", () => {
    const sig = assinaturaAthena(CORPO, SEGREDO);
    expect(assinaturaAthenaValida(CORPO, null, SEGREDO)).toBe(false);
    expect(assinaturaAthenaValida(CORPO, sig, "")).toBe(false);
    expect(assinaturaAthenaValida(CORPO, "", SEGREDO)).toBe(false);
    expect(assinaturaAthenaValida(CORPO, "sha256=", SEGREDO)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// config — o env é mockado por um objeto mutável, como nas outras suites.
// ---------------------------------------------------------------------------

const envFalso = vi.hoisted(() => ({
  ATHENA_INTEGRATION_ENABLED: "",
  ATHENA_WEBHOOK_SECRET: "",
}));

vi.mock("@/lib/env", () => ({ env: envFalso }));

describe("config — desligada por omissão", () => {
  beforeEach(() => {
    envFalso.ATHENA_INTEGRATION_ENABLED = "";
    envFalso.ATHENA_WEBHOOK_SECRET = "";
  });

  it("só o valor exato 'true' liga; tudo o resto é desligado", async () => {
    const { athenaIntegrationEnabled } = await import("./config");
    expect(athenaIntegrationEnabled()).toBe(false);
    envFalso.ATHENA_INTEGRATION_ENABLED = "True";
    expect(athenaIntegrationEnabled()).toBe(false);
    envFalso.ATHENA_INTEGRATION_ENABLED = "1";
    expect(athenaIntegrationEnabled()).toBe(false);
    envFalso.ATHENA_INTEGRATION_ENABLED = "true";
    expect(athenaIntegrationEnabled()).toBe(true);
  });

  it("segredo ausente ou curto não liga o webhook; com 32+ devolve o segredo", async () => {
    const { athenaWebhookSecret } = await import("./config");
    expect(athenaWebhookSecret()).toBe("");
    envFalso.ATHENA_WEBHOOK_SECRET = "curto";
    expect(athenaWebhookSecret()).toBe("");
    envFalso.ATHENA_WEBHOOK_SECRET = SEGREDO;
    expect(athenaWebhookSecret()).toBe(SEGREDO);
  });
});

// ---------------------------------------------------------------------------
// jobs — event_log falso, em memória.
// ---------------------------------------------------------------------------

const ORG_A = "22222222-2222-4222-8222-222222222222";
const ORG_B = "33333333-3333-4333-8333-333333333333";
const ADMIN = "11111111-1111-4111-8111-111111111111";

interface LinhaFalsa {
  id: string;
  organization_id: string;
  entity_kind: string;
  entity_id: string;
  payload: Record<string, unknown>;
  status: string;
  created_at: string;
}

function dbFalsa() {
  const linhas: LinhaFalsa[] = [];
  let seq = 0;

  const db = {
    rpc: vi.fn(async (_fn: string, params: Record<string, unknown>) => {
      linhas.push({
        id: `evt-${++seq}`,
        organization_id: params.p_organization_id as string,
        entity_kind: params.p_entity_kind as string,
        entity_id: params.p_entity_id as string,
        payload: params.p_payload as Record<string, unknown>,
        status: "pending",
        created_at: "2026-10-20T00:00:00.000Z",
      });
      return { data: null, error: null };
    }),
    from: vi.fn((_tabela: string) => ({
      select: (_cols: string) => {
        const filtros: Record<string, unknown> = {};
        const cadeia = {
          eq: (k: string, v: unknown) => {
            filtros[k] = v;
            return cadeia;
          },
          maybeSingle: async () => {
            const linha = linhas.find(
              (l) =>
                l.organization_id === filtros.organization_id &&
                l.entity_kind === filtros.entity_kind &&
                l.entity_id === filtros.entity_id,
            );
            return { data: linha ?? null, error: null };
          },
        };
        return cadeia;
      },
      update: (patch: { payload: Record<string, unknown> }) => {
        const filtros: Record<string, unknown> = {};
        const cadeia = {
          eq: (k: string, v: unknown) => {
            filtros[k] = v;
            return cadeia;
          },
          select: async (_cols: string) => {
            const linha = linhas.find(
              (l) =>
                l.id === filtros.id &&
                l.organization_id === filtros.organization_id &&
                JSON.stringify(l.payload) === JSON.stringify(filtros.payload),
            );
            if (!linha) return { data: [], error: null };
            linha.payload = patch.payload;
            return { data: [{ id: linha.id }], error: null };
          },
        };
        return cadeia;
      },
    })),
  };
  return { db: db as never, linhas };
}

describe("jobs — nasce pendente, só a decisão o move, e é de uma organização só", () => {
  it("criar → ler devolve pending_approval com o comando e a razão", async () => {
    const { db } = dbFalsa();
    const jobId = await criarJobAthena(db, {
      organizationId: ORG_A,
      command: "messages.send",
      params: { conversation_id: "c1" },
      reason: "responder ao lead",
      apiTokenId: "tok-1",
    });
    const job = await lerJobAthena(db, { organizationId: ORG_A, jobId });
    expect(job?.state).toBe("pending_approval");
    expect(job?.command).toBe("messages.send");
    expect(job?.reason).toBe("responder ao lead");
    expect(job?.decided_by).toBeNull();
  });

  it("aprovar transita para approved e regista quem decidiu; decidir de novo é recusado", async () => {
    const { db } = dbFalsa();
    const jobId = await criarJobAthena(db, {
      organizationId: ORG_A,
      command: "contacts.create",
      params: {},
    });
    const primeira = await decidirJobAthena(db, {
      organizationId: ORG_A,
      jobId,
      decision: "approve",
      decidedByUserId: ADMIN,
    });
    expect(primeira.tipo).toBe("decidido");
    if (primeira.tipo === "decidido") {
      expect(primeira.job.state).toBe("approved");
      expect(primeira.job.decided_by).toBe(ADMIN);
      expect(primeira.job.decided_at).not.toBeNull();
    }
    const segunda = await decidirJobAthena(db, {
      organizationId: ORG_A,
      jobId,
      decision: "reject",
      decidedByUserId: ADMIN,
    });
    expect(segunda.tipo).toBe("already_decided");
    const job = await lerJobAthena(db, { organizationId: ORG_A, jobId });
    expect(job?.state).toBe("approved");
  });

  it("rejeitar transita para rejected", async () => {
    const { db } = dbFalsa();
    const jobId = await criarJobAthena(db, {
      organizationId: ORG_A,
      command: "reports.generate",
      params: {},
    });
    const desfecho = await decidirJobAthena(db, {
      organizationId: ORG_A,
      jobId,
      decision: "reject",
      decidedByUserId: ADMIN,
      note: "sem contexto",
    });
    expect(desfecho.tipo).toBe("decidido");
    const job = await lerJobAthena(db, { organizationId: ORG_A, jobId });
    expect(job?.state).toBe("rejected");
  });

  it("isolamento: a organização B não lê nem decide o job da A", async () => {
    const { db } = dbFalsa();
    const jobId = await criarJobAthena(db, {
      organizationId: ORG_A,
      command: "appointments.create",
      params: {},
    });
    expect(await lerJobAthena(db, { organizationId: ORG_B, jobId })).toBeNull();
    const desfecho = await decidirJobAthena(db, {
      organizationId: ORG_B,
      jobId,
      decision: "approve",
      decidedByUserId: ADMIN,
    });
    expect(desfecho.tipo).toBe("not_found");
    const job = await lerJobAthena(db, { organizationId: ORG_A, jobId });
    expect(job?.state).toBe("pending_approval");
  });

  it("o webhook regista um evento da organização, separado dos comandos", async () => {
    const { db, linhas } = dbFalsa();
    const eventId = await registarWebhookAthena(db, {
      organizationId: ORG_A,
      event: "mission.completed",
      data: { mission_id: "m1" },
    });
    expect(eventId).toBeTruthy();
    expect(linhas).toHaveLength(1);
    expect(linhas[0]?.entity_kind).toBe("athena_webhook");
    expect(linhas[0]?.organization_id).toBe(ORG_A);
  });
});
