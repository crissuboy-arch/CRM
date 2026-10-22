/**
 * Integração Athena (contrato oficial v1) — as provas da biblioteca:
 *
 *  - a flag é desligada por omissão e só o `true` exato a liga;
 *  - o esquema da ação fecha o catálogo (tipo fora da lista e `reason`
 *    longa demais são recusados);
 *  - a ação nasce `pending_approval`, só transita por decisão, decidir
 *    duas vezes é recusado, e uma ação de outra organização é invisível —
 *    o isolamento e o gate de aprovação vivem AQUI, na camada de dados,
 *    antes de qualquer rota;
 *  - a evidência é a linha de `api_audit_log` da decisão (sem decisão, não
 *    há evidência);
 *  - as estatísticas contam a organização certa, nas janelas certas:
 *    agente arquivado não é "configurado" e corrida de ensaio não é
 *    corrida.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  criarAcaoAthena,
  decidirAcaoAthena,
  lerAcaoAthena,
  lerEvidenciaDaDecisaoAthena,
} from "./acoes";
import { acaoAthenaSchema, decisaoAthenaSchema } from "./contrato";
import {
  estatisticasDaOrganizacao,
  nomeDaOrganizacao,
  resumoDoAgenteDaOrganizacao,
} from "./estatisticas";

// ---------------------------------------------------------------------------
// config — o env é mockado por um objeto mutável, como nas outras suites.
// ---------------------------------------------------------------------------

const envFalso = vi.hoisted(() => ({
  ATHENA_INTEGRATION_ENABLED: "",
}));

vi.mock("@/lib/env", () => ({ env: envFalso }));

describe("config — desligada por omissão", () => {
  beforeEach(() => {
    envFalso.ATHENA_INTEGRATION_ENABLED = "";
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

  it("as constantes do contrato são as do documento oficial", async () => {
    const config = await import("./config");
    expect(config.ATHENA_CONTRACT_VERSION).toBe("v1");
    expect(config.ATHENA_SCOPE_STATS).toBe("athena:stats");
    expect(config.ATHENA_SCOPE_CAPABILITIES).toBe("athena:capabilities");
    expect(config.ATHENA_SCOPE_ACTIONS).toBe("athena:actions");
    expect(config.ATHENA_VERSAO_DO_PRODUTO).toBe("0.1.0");
  });
});

// ---------------------------------------------------------------------------
// contrato — os esquemas Zod fecham o catálogo.
// ---------------------------------------------------------------------------

describe("contrato — o esquema da ação", () => {
  it("aceita um tipo do catálogo e preenche params vazio por omissão", () => {
    const parsed = acaoAthenaSchema.parse({ type: "messages.send" });
    expect(parsed.type).toBe("messages.send");
    expect(parsed.params).toEqual({});
  });

  it("rejeita um tipo fora do catálogo", () => {
    const resultado = acaoAthenaSchema.safeParse({ type: "billing.charge", params: {} });
    expect(resultado.success).toBe(false);
  });

  it("rejeita reason acima de 500 caracteres e aceita exatamente 500", () => {
    expect(
      acaoAthenaSchema.safeParse({ type: "contacts.create", reason: "x".repeat(501) }).success,
    ).toBe(false);
    expect(
      acaoAthenaSchema.safeParse({ type: "contacts.create", reason: "x".repeat(500) }).success,
    ).toBe(true);
  });

  it("a decisão só é approve ou reject, com nota opcional até 500", () => {
    expect(decisaoAthenaSchema.safeParse({ decision: "approve" }).success).toBe(true);
    expect(decisaoAthenaSchema.safeParse({ decision: "talvez" }).success).toBe(false);
    expect(decisaoAthenaSchema.safeParse({ decision: "reject", note: "n".repeat(501) }).success).toBe(
      false,
    );
  });
});

// ---------------------------------------------------------------------------
// Base falsa em memória — event_log, api_audit_log e as tabelas das
// estatísticas. Suporta o vocabulário que a biblioteca usa: rpc emit_event,
// select+eq+maybeSingle, update com CAS por payload, select com
// count/head + eq/in/gte/is encadeáveis e awaitável, e a consulta da
// evidência (eq/in/order/limit → { data: [...] }).
// ---------------------------------------------------------------------------

const ORG_A = "22222222-2222-4222-8222-222222222222";
const ORG_B = "33333333-3333-4333-8333-333333333333";
const ORG_C = "44444444-4444-4444-8444-444444444444";
const ADMIN = "11111111-1111-4111-8111-111111111111";
const CRIADO_EM = "2026-10-22T09:01:00.000Z";
const AGORA = new Date("2026-10-22T12:00:00.000Z");

type Linha = Record<string, unknown>;
type Filtro = (linha: Linha) => boolean;

interface ResultadoFalso {
  data: unknown;
  error: null;
  count: number | null;
}

function valoresIguais(a: unknown, b: unknown): boolean {
  if (a !== null && b !== null && typeof a === "object" && typeof b === "object") {
    return JSON.stringify(a) === JSON.stringify(b);
  }
  return a === b;
}

function criarDbFalsa() {
  const tabelas: Record<string, Linha[]> = {
    event_log: [],
    api_audit_log: [],
    organizations: [],
    conversations: [],
    crm_leads: [],
    contacts: [],
    ai_agents: [],
    ai_agent_runs: [],
    agent_cases: [],
  };
  let seqEvento = 0;

  const aplicarFiltros = (tabela: string, filtros: Filtro[]): Linha[] =>
    (tabelas[tabela] ?? []).filter((l) => filtros.every((f) => f(l)));

  function novaCadeiaSelect(tabela: string, opcoes?: { count?: string; head?: boolean }) {
    const filtros: Filtro[] = [];
    let ordem: { col: string; asc: boolean } | null = null;
    let limite: number | null = null;

    const executar = (): ResultadoFalso => {
      let linhas = aplicarFiltros(tabela, filtros);
      const total = linhas.length;
      if (ordem) {
        const { col, asc } = ordem;
        linhas = [...linhas].sort((a, b) => {
          const av = String(a[col] ?? "");
          const bv = String(b[col] ?? "");
          return asc ? av.localeCompare(bv) : bv.localeCompare(av);
        });
      }
      if (limite !== null) linhas = linhas.slice(0, limite);
      if (opcoes?.count === "exact") {
        return { data: opcoes.head ? null : linhas, error: null, count: total };
      }
      return { data: linhas, error: null, count: null };
    };

    const cadeia = {
      eq(col: string, valor: unknown) {
        filtros.push((l) => valoresIguais(l[col], valor));
        return cadeia;
      },
      in(col: string, valores: unknown[]) {
        filtros.push((l) => valores.some((v) => valoresIguais(l[col], v)));
        return cadeia;
      },
      gte(col: string, valor: unknown) {
        filtros.push((l) => String(l[col] ?? "") >= String(valor));
        return cadeia;
      },
      is(col: string, valor: unknown) {
        filtros.push((l) => (l[col] ?? null) === valor);
        return cadeia;
      },
      order(col: string, o?: { ascending?: boolean }) {
        ordem = { col, asc: o?.ascending !== false };
        return cadeia;
      },
      limit(n: number) {
        limite = n;
        return cadeia;
      },
      maybeSingle: async (): Promise<{ data: Linha | null; error: null }> => {
        const linhas = aplicarFiltros(tabela, filtros);
        return { data: linhas[0] ?? null, error: null };
      },
      then<TResult1 = ResultadoFalso, TResult2 = never>(
        onfulfilled?: ((value: ResultadoFalso) => TResult1 | PromiseLike<TResult1>) | null,
        onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
      ): Promise<TResult1 | TResult2> {
        return Promise.resolve(executar()).then(onfulfilled, onrejected);
      },
    };
    return cadeia;
  }

  function novaCadeiaUpdate(tabela: string, patch: Linha) {
    const filtros: Filtro[] = [];
    const cadeia = {
      eq(col: string, valor: unknown) {
        filtros.push((l) => valoresIguais(l[col], valor));
        return cadeia;
      },
      select: async (_cols: string) => {
        const linhas = aplicarFiltros(tabela, filtros);
        for (const l of linhas) Object.assign(l, patch);
        return { data: linhas.map((l) => ({ id: l.id })), error: null };
      },
    };
    return cadeia;
  }

  const db = {
    rpc: async (_fn: string, params: Record<string, unknown>) => {
      (tabelas.event_log ??= []).push({
        id: `evt-${++seqEvento}`,
        organization_id: params.p_organization_id,
        entity_kind: params.p_entity_kind,
        entity_id: params.p_entity_id,
        payload: params.p_payload,
        metadata: params.p_metadata,
        status: "pending",
        created_at: CRIADO_EM,
      });
      return { data: null, error: null };
    },
    from: (tabela: string) => ({
      select: (_cols: string, opcoes?: { count?: string; head?: boolean }) =>
        novaCadeiaSelect(tabela, opcoes),
      update: (patch: Linha) => novaCadeiaUpdate(tabela, patch),
    }),
  };

  return {
    db: db as never,
    tabelas,
    inserir: (tabela: string, linha: Linha) => {
      (tabelas[tabela] ??= []).push(linha);
    },
  };
}

// ---------------------------------------------------------------------------
// ações — nasce pendente, só a decisão a move, e é de uma organização só.
// ---------------------------------------------------------------------------

describe("ações — nasce pendente, só a decisão a move, e é de uma organização só", () => {
  it("criar devolve o registo completo em pending_approval, com o created_at do banco", async () => {
    const { db } = criarDbFalsa();
    const acao = await criarAcaoAthena(db, {
      organizationId: ORG_A,
      type: "messages.send",
      params: { conversation_id: "c1" },
      reason: "responder ao lead",
      apiTokenId: "tok-1",
    });
    expect(acao.action_id).toBeTruthy();
    expect(acao.organization_id).toBe(ORG_A);
    expect(acao.type).toBe("messages.send");
    expect(acao.state).toBe("pending_approval");
    expect(acao.reason).toBe("responder ao lead");
    expect(acao.created_at).toBe(CRIADO_EM);
    expect(acao.decided_by).toBeNull();
    expect(acao.decided_at).toBeNull();
    expect(acao.decision_note).toBeNull();
    expect(acao.decided_by_role).toBeNull();

    const lida = await lerAcaoAthena(db, { organizationId: ORG_A, actionId: acao.action_id });
    expect(lida).toEqual(acao);
  });

  it("aprovar regista decided_by, decided_at, decided_by_role e decision_note; decidir de novo é recusado", async () => {
    const { db } = criarDbFalsa();
    const acao = await criarAcaoAthena(db, {
      organizationId: ORG_A,
      type: "contacts.create",
      params: {},
    });
    const primeira = await decidirAcaoAthena(db, {
      organizationId: ORG_A,
      actionId: acao.action_id,
      decision: "approve",
      decidedByUserId: ADMIN,
      decidedByRole: "admin",
      note: "pode criar",
    });
    expect(primeira.tipo).toBe("decidido");
    if (primeira.tipo === "decidido") {
      expect(primeira.acao.state).toBe("approved");
      expect(primeira.acao.decided_by).toBe(ADMIN);
      expect(primeira.acao.decided_at).not.toBeNull();
      expect(primeira.acao.decided_by_role).toBe("admin");
      expect(primeira.acao.decision_note).toBe("pode criar");
    }
    const persistida = await lerAcaoAthena(db, { organizationId: ORG_A, actionId: acao.action_id });
    expect(persistida?.state).toBe("approved");
    expect(persistida?.decided_by_role).toBe("admin");
    expect(persistida?.decision_note).toBe("pode criar");

    const segunda = await decidirAcaoAthena(db, {
      organizationId: ORG_A,
      actionId: acao.action_id,
      decision: "reject",
      decidedByUserId: ADMIN,
      decidedByRole: "admin",
    });
    expect(segunda.tipo).toBe("already_decided");
    const final = await lerAcaoAthena(db, { organizationId: ORG_A, actionId: acao.action_id });
    expect(final?.state).toBe("approved");
  });

  it("rejeitar transita para rejected", async () => {
    const { db } = criarDbFalsa();
    const acao = await criarAcaoAthena(db, {
      organizationId: ORG_A,
      type: "reports.generate",
      params: {},
    });
    const desfecho = await decidirAcaoAthena(db, {
      organizationId: ORG_A,
      actionId: acao.action_id,
      decision: "reject",
      decidedByUserId: ADMIN,
      decidedByRole: "admin",
      note: "sem contexto",
    });
    expect(desfecho.tipo).toBe("decidido");
    const lida = await lerAcaoAthena(db, { organizationId: ORG_A, actionId: acao.action_id });
    expect(lida?.state).toBe("rejected");
    expect(lida?.decision_note).toBe("sem contexto");
  });

  it("isolamento: a organização B não lê nem decide a ação da A", async () => {
    const { db } = criarDbFalsa();
    const acao = await criarAcaoAthena(db, {
      organizationId: ORG_A,
      type: "appointments.create",
      params: {},
    });
    expect(await lerAcaoAthena(db, { organizationId: ORG_B, actionId: acao.action_id })).toBeNull();
    const desfecho = await decidirAcaoAthena(db, {
      organizationId: ORG_B,
      actionId: acao.action_id,
      decision: "approve",
      decidedByUserId: ADMIN,
      decidedByRole: "admin",
    });
    expect(desfecho.tipo).toBe("not_found");
    const lida = await lerAcaoAthena(db, { organizationId: ORG_A, actionId: acao.action_id });
    expect(lida?.state).toBe("pending_approval");
  });

  it("leitura robusta: uma linha legada com `command` no payload lê-se com esse tipo", async () => {
    const { db, inserir } = criarDbFalsa();
    inserir("event_log", {
      id: "evt-legado",
      organization_id: ORG_A,
      entity_kind: "athena_action",
      entity_id: "acao-legada",
      payload: { command: "messages.send", params: {}, reason: null, state: "pending_approval" },
      status: "pending",
      created_at: CRIADO_EM,
    });
    const lida = await lerAcaoAthena(db, { organizationId: ORG_A, actionId: "acao-legada" });
    expect(lida?.type).toBe("messages.send");
    expect(lida?.state).toBe("pending_approval");
  });
});

// ---------------------------------------------------------------------------
// evidência — a linha de api_audit_log da decisão.
// ---------------------------------------------------------------------------

describe("evidência — sem decisão não há recibo; com decisão, é a linha da auditoria", () => {
  it("devolve null enquanto ninguém decidiu", async () => {
    const { db } = criarDbFalsa();
    const acao = await criarAcaoAthena(db, {
      organizationId: ORG_A,
      type: "messages.send",
      params: {},
    });
    expect(
      await lerEvidenciaDaDecisaoAthena(db, { organizationId: ORG_A, actionId: acao.action_id }),
    ).toBeNull();
  });

  it("devolve a linha certa entre iscas de outra org, outra ação e outro tipo de ato", async () => {
    const { db, inserir } = criarDbFalsa();
    const acao = await criarAcaoAthena(db, {
      organizationId: ORG_A,
      type: "messages.send",
      params: {},
    });
    inserir("api_audit_log", {
      id: "log-outra-org",
      organization_id: ORG_B,
      resource_type: "athena_action",
      resource_id: acao.action_id,
      action: "athena.command_approved",
      actor_user_id: ADMIN,
      created_at: "2026-10-22T09:05:00.000Z",
    });
    inserir("api_audit_log", {
      id: "log-outra-acao",
      organization_id: ORG_A,
      resource_type: "athena_action",
      resource_id: "outra-acao",
      action: "athena.command_approved",
      actor_user_id: ADMIN,
      created_at: "2026-10-22T09:05:00.000Z",
    });
    inserir("api_audit_log", {
      id: "log-recebido",
      organization_id: ORG_A,
      resource_type: "athena_action",
      resource_id: acao.action_id,
      action: "athena.command_received",
      actor_user_id: null,
      created_at: "2026-10-22T09:01:00.000Z",
    });
    inserir("api_audit_log", {
      id: "log-decisao",
      organization_id: ORG_A,
      resource_type: "athena_action",
      resource_id: acao.action_id,
      action: "athena.command_approved",
      actor_user_id: ADMIN,
      created_at: "2026-10-22T09:05:31.000Z",
    });

    const evidencia = await lerEvidenciaDaDecisaoAthena(db, {
      organizationId: ORG_A,
      actionId: acao.action_id,
    });
    expect(evidencia).toEqual({
      log_id: "log-decisao",
      action: "athena.command_approved",
      actor_user_id: ADMIN,
      created_at: "2026-10-22T09:05:31.000Z",
    });
  });

  it("com duas linhas de decisão, vence a mais recente", async () => {
    const { db, inserir } = criarDbFalsa();
    inserir("api_audit_log", {
      id: "log-antigo",
      organization_id: ORG_A,
      resource_type: "athena_action",
      resource_id: "acao-1",
      action: "athena.command_approved",
      actor_user_id: ADMIN,
      created_at: "2026-10-22T09:05:00.000Z",
    });
    inserir("api_audit_log", {
      id: "log-recente",
      organization_id: ORG_A,
      resource_type: "athena_action",
      resource_id: "acao-1",
      action: "athena.command_rejected",
      actor_user_id: ADMIN,
      created_at: "2026-10-22T09:07:00.000Z",
    });
    const evidencia = await lerEvidenciaDaDecisaoAthena(db, {
      organizationId: ORG_A,
      actionId: "acao-1",
    });
    expect(evidencia?.log_id).toBe("log-recente");
    expect(evidencia?.action).toBe("athena.command_rejected");
  });
});

// ---------------------------------------------------------------------------
// estatísticas — contagens reais, por organização, nas janelas de 30 dias.
// Corte com AGORA = 2026-10-22T12:00Z → corte = 2026-09-22T12:00Z.
// ---------------------------------------------------------------------------

function semearEstatisticas(inserir: (tabela: string, linha: Linha) => void) {
  const em = (tabela: string, organization_id: string, campos: Linha) =>
    inserir(tabela, { organization_id, ...campos });
  const recente = "2026-10-22T10:00:00.000Z";

  // Conversas da A: 4 abertas (open/pending/claimed/ai_handling), 2 em curso
  // (claimed/ai_handling), 2 fechadas dentro da janela, 1 fechada fora dela.
  for (const status of ["open", "pending", "claimed", "ai_handling"]) {
    em("conversations", ORG_A, { status, updated_at: recente });
  }
  em("conversations", ORG_A, { status: "resolved", updated_at: "2026-10-20T00:00:00.000Z" });
  em("conversations", ORG_A, { status: "closed", updated_at: "2026-10-01T00:00:00.000Z" });
  em("conversations", ORG_A, { status: "resolved", updated_at: "2026-08-01T00:00:00.000Z" });
  em("conversations", ORG_B, { status: "open", updated_at: recente });
  em("conversations", ORG_B, { status: "open", updated_at: recente });

  // Leads da A: 3 no total, 2 novos na janela. Os 5 da B não podem vazar.
  em("crm_leads", ORG_A, { created_at: "2026-10-10T00:00:00.000Z" });
  em("crm_leads", ORG_A, { created_at: "2026-10-21T00:00:00.000Z" });
  em("crm_leads", ORG_A, { created_at: "2026-01-01T00:00:00.000Z" });
  for (let i = 0; i < 5; i++) em("crm_leads", ORG_B, { created_at: recente });

  for (let i = 0; i < 4; i++) em("contacts", ORG_A, {});
  for (let i = 0; i < 2; i++) em("contacts", ORG_B, {});

  // Agentes da A: 2 configurados (não arquivados), 1 ativo; o arquivado —
  // mesmo ativo — não conta em lado nenhum.
  em("ai_agents", ORG_A, { archived_at: null, is_active: true });
  em("ai_agents", ORG_A, { archived_at: null, is_active: false });
  em("ai_agents", ORG_A, { archived_at: "2026-10-01T00:00:00.000Z", is_active: true });
  em("ai_agents", ORG_B, { archived_at: null, is_active: true });
  // A C só tem um agente arquivado.
  em("ai_agents", ORG_C, { archived_at: "2026-09-01T00:00:00.000Z", is_active: true });

  // Corridas da A: 2 reais na janela; a de ensaio e a antiga não contam.
  em("ai_agent_runs", ORG_A, { created_at: "2026-10-15T00:00:00.000Z", is_dry_run: false });
  em("ai_agent_runs", ORG_A, { created_at: "2026-10-16T00:00:00.000Z", is_dry_run: false });
  em("ai_agent_runs", ORG_A, { created_at: "2026-10-17T00:00:00.000Z", is_dry_run: true });
  em("ai_agent_runs", ORG_A, { created_at: "2026-01-01T00:00:00.000Z", is_dry_run: false });

  // Casos de suporte da A: 2 abertos (awaiting_human/awaiting_lead).
  em("agent_cases", ORG_A, { status: "awaiting_human" });
  em("agent_cases", ORG_A, { status: "awaiting_lead" });
  em("agent_cases", ORG_A, { status: "resolved" });
  for (let i = 0; i < 3; i++) em("agent_cases", ORG_B, { status: "awaiting_human" });

  inserir("organizations", { id: ORG_A, display_name: "Empresa A", legal_name: "Empresa A, Lda." });
  inserir("organizations", { id: ORG_B, display_name: "", legal_name: "Empresa B, Lda." });
  inserir("organizations", { id: ORG_C, display_name: "  ", legal_name: "" });
}

describe("estatísticas — contagens da organização, janelas de 30 dias", () => {
  it("conta cada grupo com o recorte certo e só da organização pedida", async () => {
    const { db, inserir } = criarDbFalsa();
    semearEstatisticas(inserir);
    const stats = await estatisticasDaOrganizacao(db, ORG_A, AGORA);
    expect(stats.organization).toEqual({ id: ORG_A, name: "Empresa A" });
    expect(stats.conversations).toEqual({ open: 4, in_progress: 2, closed_30d: 2 });
    expect(stats.leads).toEqual({ total: 3, new_30d: 2 });
    expect(stats.contacts).toEqual({ total: 4 });
    expect(stats.agents).toEqual({ configured: 2, active: 1, runs_30d: 2 });
    expect(stats.support).toEqual({ cases_open: 2 });
  });

  it("o nome cai para o legal quando o display está vazio, e para '' quando não há nenhum", async () => {
    const { db, inserir } = criarDbFalsa();
    semearEstatisticas(inserir);
    expect(await nomeDaOrganizacao(db, ORG_A)).toBe("Empresa A");
    expect(await nomeDaOrganizacao(db, ORG_B)).toBe("Empresa B, Lda.");
    expect(await nomeDaOrganizacao(db, ORG_C)).toBe("");
    expect(
      await nomeDaOrganizacao(db, "99999999-9999-4999-8999-999999999999"),
    ).toBe("");
  });

  it("o resumo do agente distingue configurado de ativo — e arquivado não é nenhum dos dois", async () => {
    const { db, inserir } = criarDbFalsa();
    semearEstatisticas(inserir);
    expect(await resumoDoAgenteDaOrganizacao(db, ORG_A)).toEqual({
      configured: true,
      active: true,
    });
    expect(await resumoDoAgenteDaOrganizacao(db, ORG_C)).toEqual({
      configured: false,
      active: false,
    });
    const statsC = await estatisticasDaOrganizacao(db, ORG_C, AGORA);
    expect(statsC.agents).toEqual({ configured: 0, active: 0, runs_30d: 0 });
  });
});
