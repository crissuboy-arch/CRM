import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { sql, countAs } from "./gov-helpers";

const orgA = randomUUID(), orgB = randomUUID(), user = randomUUID();
const contactA = randomUUID(), contactB = randomUUID();
const sessionA = randomUUID(), sessionB = randomUUID();

function identity(org: string, contact: string, session: string, external: string = randomUUID()) {
  return `insert into public.contact_channel_identities
    (organization_id,contact_id,channel_session_id,provider,external_user_id)
    values('${org}','${contact}','${session}','instagram_meta','${external}');`;
}

beforeAll(() => {
  sql(`insert into auth.users(id,email) values('${user}','${user}@invariant.test');
    insert into public.organizations(id,slug,legal_name,display_name) values
    ('${orgA}','ig-${orgA}','Foundation A','Foundation A'),
    ('${orgB}','ig-${orgB}','Foundation B','Foundation B');
    insert into public.user_organizations(user_id,organization_id,role,accepted_at)
    values('${user}','${orgA}','agent',now());
    insert into public.contacts(id,organization_id,display_name) values
    ('${contactA}','${orgA}','Synthetic A'),('${contactB}','${orgB}','Synthetic B');
    insert into public.channel_sessions(id,organization_id,provider,instagram_account_id,webhook_secret_encrypted) values
    ('${sessionA}','${orgA}','instagram_meta','same-account','\\x00'),
    ('${sessionB}','${orgB}','instagram_meta','same-account','\\x00');
    ${identity(orgA,contactA,sessionA,'same-external')}
    ${identity(orgB,contactB,sessionB,'same-external')}`);
});

describe("0231 — identidade multicanal", () => {
  it("reaplica a migration com identidades existentes sem perder dados", () => {
    const migration = readFileSync("supabase/migrations/20260914010000_0231_instagram_channel_foundation.sql", "utf8");
    sql(migration);
    sql(migration);
    expect(sql(`select count(*) from public.contact_channel_identities where organization_id in ('${orgA}','${orgB}')`)).toBe("2");
  });
  it("RLS mostra somente a organização do usuário, mesmo com IDs externos iguais", () => {
    expect(countAs(user, `select count(*) from public.contact_channel_identities where organization_id='${orgA}'`)).toBe(1);
    expect(countAs(user, `select count(*) from public.contact_channel_identities where organization_id='${orgB}'`)).toBe(0);
  });
  it("recusa contato e sessão de outro tenant, inclusive com service role", () => {
    expect(() => sql(`set role service_role; ${identity(orgA,contactB,sessionA)}`)).toThrow(/channel_identity_contact_unavailable/);
    expect(() => sql(`set role service_role; ${identity(orgA,contactA,sessionB)}`)).toThrow(/contact_channel_identities_session_fkey/);
  });
  it("deduplica identidade por sessão e impede escrita authenticated/anon", () => {
    expect(() => sql(identity(orgA,contactA,sessionA,'same-external'))).toThrow(/contact_channel_identities_external_unique/);
    expect(() => sql(`set role authenticated; ${identity(orgA,contactA,sessionA)}`)).toThrow(/permission denied/);
    expect(() => sql('set role anon; select * from public.contact_channel_identities;')).toThrow(/permission denied/);
  });
  it("a FK também impede adulterar o provider da identidade", () => {
    expect(() => sql(`update public.contact_channel_identities set provider='meta_cloud' where organization_id='${orgA}';`)).toThrow(/contact_channel_identities_session_fkey/);
  });
  it("rejeita sessão sem referência e conta ativa duplicada", () => {
    expect(() => sql(`insert into public.channel_sessions(organization_id,provider,webhook_secret_encrypted)
      values('${orgA}','instagram_meta','\\x00')`)).toThrow(/channel_sessions_provider_ref_check/);
    expect(() => sql(`insert into public.channel_sessions(organization_id,provider,instagram_account_id,webhook_secret_encrypted)
      values('${orgA}','instagram_meta','same-account','\\x00')`)).toThrow(/channel_sessions_instagram_active_unique/);
  });
  it("uma conversa Instagram exige contato e sessão do mesmo tenant", () => {
    expect(() => sql(`insert into public.conversations(organization_id,contact_id,channel_session_id,channel)
      values('${orgA}','${contactA}','${sessionB}','instagram')`)).toThrow(/instagram_conversation_scope/);
    expect(() => sql(`insert into public.conversations(organization_id,contact_id,channel_session_id,channel)
      values('${orgA}','${contactB}','${sessionA}','instagram')`)).toThrow(/instagram_conversation_scope/);
  });
  it("aceita uma conversa Instagram válida nas tabelas canônicas", () => {
    const conversation = randomUUID();
    sql(`insert into public.conversations(id,organization_id,contact_id,channel_session_id,channel)
      values('${conversation}','${orgA}','${contactA}','${sessionA}','instagram');`);
    expect(sql(`select channel from public.conversations where organization_id='${orgA}' and id='${conversation}'`)).toBe("instagram");
  });
  it("a anonimização remove identidade e impede sua recriação", () => {
    const contact = randomUUID();
    sql(`insert into public.contacts(id,organization_id,display_name) values('${contact}','${orgA}','Synthetic redaction');
      ${identity(orgA,contact,sessionA)}
      update public.contacts set is_anonymized=true where organization_id='${orgA}' and id='${contact}';`);
    expect(sql(`select count(*) from public.contact_channel_identities where organization_id='${orgA}' and contact_id='${contact}'`)).toBe('0');
    expect(() => sql(identity(orgA,contact,sessionA))).toThrow(/channel_identity_contact_unavailable/);
  });
  it("a RPC canônica contabiliza a identidade apagada e preserva o vizinho", () => {
    const contact = randomUUID();
    sql(`insert into public.contacts(id,organization_id,display_name) values('${contact}','${orgA}','Synthetic canonical redaction');
      ${identity(orgA,contact,sessionA)}`);
    expect(sql(`select public.fn_lgpd_cascade_redact_contact('${orgA}','${contact}','${randomUUID()}')->'counts'->>'contact_channel_identities'`)).toBe("1");
    expect(sql(`select count(*) from public.contact_channel_identities where organization_id='${orgB}' and contact_id='${contactB}'`)).toBe("1");
  });
});
