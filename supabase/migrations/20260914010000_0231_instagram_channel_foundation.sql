-- 0231 — PHASE 1: vocabulário e identidade multicanal. Sem OAuth ou envio.
alter table public.channel_sessions add column if not exists instagram_account_id text;
alter table public.channel_sessions drop constraint if exists channel_sessions_provider_check;
alter table public.channel_sessions add constraint channel_sessions_provider_check
 check (provider = any(array['waha'::text,'meta_cloud'::text,'zernio'::text,'instagram_meta'::text]));
alter table public.channel_sessions drop constraint if exists channel_sessions_provider_ref_check;
alter table public.channel_sessions add constraint channel_sessions_provider_ref_check check (
 (provider = 'waha' and waha_session_name is not null and instagram_account_id is null) or
 (provider = 'meta_cloud' and meta_phone_number_id is not null and instagram_account_id is null) or
 (provider = 'zernio' and zernio_account_id is not null and instagram_account_id is null) or
 (provider = 'instagram_meta' and instagram_account_id is not null and length(btrim(instagram_account_id))>0
  and waha_session_name is null and meta_phone_number_id is null and zernio_account_id is null)
);
-- O escopo é a organização; uma conta não abre duas sessões ativas no tenant.
create unique index if not exists channel_sessions_instagram_active_unique
 on public.channel_sessions(organization_id,instagram_account_id)
 where provider='instagram_meta' and archived_at is null;
alter table public.conversations drop constraint if exists conversations_channel_check;
alter table public.conversations add constraint conversations_channel_check
 check(channel in ('whatsapp','instagram'));

create unique index if not exists contacts_org_id_unique on public.contacts(organization_id,id);
create unique index if not exists channel_sessions_org_id_provider_unique
 on public.channel_sessions(organization_id,id,provider);

create table if not exists public.contact_channel_identities (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id) on delete cascade,
 contact_id uuid not null,
 channel_session_id uuid not null,
 provider text not null,
 external_user_id text not null check(length(btrim(external_user_id))>0),
 username text,
 display_name text,
 profile_metadata jsonb not null default '{}'::jsonb check(jsonb_typeof(profile_metadata)='object'),
 last_seen_at timestamptz,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 constraint contact_channel_identities_external_unique unique(organization_id,channel_session_id,external_user_id),
 constraint contact_channel_identities_contact_fkey foreign key(organization_id,contact_id)
  references public.contacts(organization_id,id) on delete cascade,
 constraint contact_channel_identities_session_fkey foreign key(organization_id,channel_session_id,provider)
  references public.channel_sessions(organization_id,id,provider) on delete cascade
);
create index if not exists contact_channel_identities_contact_idx
 on public.contact_channel_identities(organization_id,contact_id);
alter table public.contact_channel_identities enable row level security;
revoke all on public.contact_channel_identities from public,anon,authenticated,service_role;
grant select on public.contact_channel_identities to authenticated;
grant select,insert,update,delete on public.contact_channel_identities to service_role;
drop policy if exists tenant_isolation_contact_channel_identities_select on public.contact_channel_identities;
create policy tenant_isolation_contact_channel_identities_select
 on public.contact_channel_identities for select to authenticated
 using (organization_id in (select public.fn_user_org_ids()));

-- Identidade externa é dado pessoal. Não sobrevive ao contato anonimizado.
create or replace function public.fn_redact_contact_channel_identities()
returns trigger language plpgsql security definer set search_path=public as $$
begin
 delete from public.contact_channel_identities where organization_id=new.organization_id and contact_id=new.id;
 return new;
end;$$;
revoke all on function public.fn_redact_contact_channel_identities() from public,anon,authenticated;
drop trigger if exists trg_redact_contact_channel_identities on public.contacts;
create trigger trg_redact_contact_channel_identities after update on public.contacts
 for each row when(new.is_anonymized is true) execute function public.fn_redact_contact_channel_identities();

-- Mesma ordem de locks da anonimização; não associa uma identidade a contato inativo.
create or replace function public.fn_guard_contact_channel_identity()
returns trigger language plpgsql security definer set search_path=public as $$
begin
 perform public.fn_service_lock(new.organization_id,new.contact_id);
 if not exists(select 1 from public.contacts where organization_id=new.organization_id and id=new.contact_id
  and not is_anonymized and is_merged_into is null) then
  raise exception 'channel_identity_contact_unavailable' using errcode='23503';
 end if;
 new.updated_at:=now();
 return new;
end;$$;
revoke all on function public.fn_guard_contact_channel_identity() from public,anon,authenticated;
drop trigger if exists trg_guard_contact_channel_identity on public.contact_channel_identities;
create trigger trg_guard_contact_channel_identity before insert or update on public.contact_channel_identities
 for each row execute function public.fn_guard_contact_channel_identity();

-- A nova conversa não pode usar sessão/contato de outro tenant nem trocar
-- Instagram por WhatsApp. Não reinterpreta registros legados.
create or replace function public.fn_guard_instagram_conversation()
returns trigger language plpgsql security definer set search_path=public as $$
declare session_provider text;
begin
 select provider into session_provider from public.channel_sessions
  where organization_id=new.organization_id and id=new.channel_session_id;
 if new.channel='instagram' then
  if session_provider is distinct from 'instagram_meta' or new.contact_id is null or new.is_group
   or not exists(select 1 from public.contacts where organization_id=new.organization_id and id=new.contact_id) then
   raise exception 'instagram_conversation_scope' using errcode='23503';
  end if;
 elsif session_provider='instagram_meta' then
  raise exception 'instagram_conversation_channel' using errcode='23514';
 end if;
 return new;
end;$$;
revoke all on function public.fn_guard_instagram_conversation() from public,anon,authenticated;
drop trigger if exists trg_guard_instagram_conversation on public.conversations;
create trigger trg_guard_instagram_conversation before insert or update of channel,channel_session_id,contact_id,organization_id,is_group on public.conversations
 for each row execute function public.fn_guard_instagram_conversation();

-- A RPC canônica e o trigger cobrem os dois caminhos de anonimização.
CREATE OR REPLACE FUNCTION "public"."fn_lgpd_cascade_redact_contact"("p_organization_id" "uuid", "p_contact_id" "uuid", "p_request_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $
declare
  v_already bool;
  v_counts jsonb := '{}'::jsonb;
  v_media_paths text[] := '{}';
  v_anon_label text;
  v_count int;
begin
  perform public.fn_service_lock(p_organization_id,p_contact_id);
  select is_anonymized into v_already
    from contacts
    where id = p_contact_id and organization_id = p_organization_id;

  if not found then
    raise exception 'contact not found' using errcode = 'P0002';
  end if;

  -- A identidade é dado da pessoa; a RPC canônica também alcança resíduos
  -- de contato já anonimizado. O trigger cobre UPDATE direto no contato.
  delete from public.contact_channel_identities
    where organization_id = p_organization_id and contact_id = p_contact_id;
  get diagnostics v_count = row_count;
  v_counts := v_counts || jsonb_build_object('contact_channel_identities', v_count);

  if v_already then
    return jsonb_build_object('already_anonymized', true, 'counts', v_counts, 'media_paths', v_media_paths);
  end if;

  v_anon_label := 'Cliente Anonimizado #' || substring(p_contact_id::text from 1 for 8);

  -- Collect media storage paths (we only delete what we own — media_storage_path)
  select coalesce(array_agg(distinct media_storage_path) filter (where media_storage_path is not null), '{}')
    into v_media_paths
    from messages
    where organization_id = p_organization_id
      and conversation_id in (
        select id from conversations
          where contact_id = p_contact_id and organization_id = p_organization_id
      );

  -- 1. contacts (irreversible)
  update contacts set
    name = v_anon_label,
    display_name = v_anon_label,
    email = null,
    -- email_normalized NÃO entra: é GENERATED ALWAYS AS (lower(trim(email)))
    -- e o Postgres recusa escrita nela — a linha acima já a zera por derivação.
    -- Com a atribuição, o cascade INTEIRO abortava e nada era anonimizado.
    phone_number = null,
    cpf_encrypted = null,
    cpf_hash = null,
    birthdate = null,
    is_anonymized = true,
    anonymized_at = now(),
    consent = '{}'::jsonb,
    source_metadata = '{}'::jsonb,
    tags = '{}'::text[],
    updated_at = now()
  where id = p_contact_id and organization_id = p_organization_id;
  get diagnostics v_count = row_count;
  v_counts := v_counts || jsonb_build_object('contacts', v_count);

  -- 2. conversations metadata + preview strip
  update conversations set
    metadata = '{}'::jsonb,
    last_message_preview = null,
    updated_at = now()
  where contact_id = p_contact_id and organization_id = p_organization_id;
  get diagnostics v_count = row_count;
  v_counts := v_counts || jsonb_build_object('conversations', v_count);

  -- 3. messages: redact body + null media + strip metadata (preserve status/timestamps/conversation_id)
  update messages set
    body = '[mensagem anonimizada]',
    media_url = null,
    media_mime = null,
    media_size_bytes = null,
    media_storage_path = null,
    metadata = '{}'::jsonb,
    updated_at = now()
  where organization_id = p_organization_id
    and conversation_id in (
      select id from conversations
        where contact_id = p_contact_id and organization_id = p_organization_id
    );
  get diagnostics v_count = row_count;
  v_counts := v_counts || jsonb_build_object('messages', v_count);

  -- 4. crm_lead_activities — strip payload, metadata E reason (migration 0071).
  --    `reason` é texto livre escrito por LLM sobre a conversa do lead: supor que
  --    nunca conterá um nome é a suposição que falha. `evidence` NÃO é limpa —
  --    guarda só ids, e as linhas apontadas são redigidas por conta própria.
  update crm_lead_activities set
    payload = '{}'::jsonb,
    metadata = '{}'::jsonb,
    reason = null
  where organization_id = p_organization_id
    and (
      contact_id = p_contact_id
      or lead_id in (
        select lead_id from crm_lead_links
          where target_kind = 'contact'
            and target_id = p_contact_id
            and organization_id = p_organization_id
      )
      or lead_id in (
        select id from crm_leads
          where contact_id = p_contact_id and organization_id = p_organization_id
      )
    );
  get diagnostics v_count = row_count;
  v_counts := v_counts || jsonb_build_object('activities', v_count);

  -- 5. crm_leads — strip title/description/custom_fields/source_metadata/tags but PRESERVE pipeline/stage/value
  update crm_leads set
    title = v_anon_label,
    description = null,
    custom_fields = '{}'::jsonb,
    source_metadata = '{}'::jsonb,
    tags = '{}'::text[],
    updated_at = now()
  where organization_id = p_organization_id
    and (
      contact_id = p_contact_id
      or id in (
        select lead_id from crm_lead_links
          where target_kind = 'contact'
            and target_id = p_contact_id
            and organization_id = p_organization_id
      )
    );
  get diagnostics v_count = row_count;
  v_counts := v_counts || jsonb_build_object('leads', v_count);

  -- 6. orders — PRESERVE values + status + timestamps. Strip personal fields from payload jsonb
  --    and replace customer_external_id with null (FK-safe; soft de-link). Keep contact_id null.
  update orders set
    payload = (coalesce(payload, '{}'::jsonb))
      - 'customer'
      - 'customer_name'
      - 'customer_email'
      - 'customer_phone'
      - 'shipping_address'
      - 'billing_address'
      - 'contact_identification',
    customer_external_id = null,
    contact_id = null,
    is_anonymized = true,
    updated_at = now()
  where organization_id = p_organization_id
    and contact_id = p_contact_id;
  get diagnostics v_count = row_count;
  v_counts := v_counts || jsonb_build_object('orders', v_count);

  -- 7. enqueue media for async deletion (idempotent via unique (bucket, object_path))
  if array_length(v_media_paths, 1) > 0 then
    insert into storage_redaction_queue (organization_id, request_id, bucket, object_path)
    select p_organization_id, p_request_id, 'whatsapp-media', path
      from unnest(v_media_paths) as path
      where path is not null and length(path) > 0
    on conflict (bucket, object_path) do nothing;
  end if;

  -- 8. dense audit row
  insert into api_audit_log (organization_id, action, actor_user_id, resource_type, resource_id, metadata, bypassed_rls)
  values (
    p_organization_id,
    'lgpd.redact_executed',
    null,
    'contact',
    p_contact_id,
    jsonb_build_object(
      'cascaded_to', v_counts,
      'media_queued', coalesce(array_length(v_media_paths, 1), 0),
      'request_id', p_request_id
    ),
    true
  );

  return jsonb_build_object(
    'already_anonymized', false,
    'counts', v_counts,
    'media_paths', v_media_paths
  );
end;
$;
revoke all on function public.fn_lgpd_cascade_redact_contact(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.fn_lgpd_cascade_redact_contact(uuid,uuid,uuid) to service_role;

notify pgrst,'reload schema';
