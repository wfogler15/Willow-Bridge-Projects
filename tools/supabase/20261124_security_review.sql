-- Nov 24 2026 code review: tighten function access and two policies. No data changes.

-- 1. Access-check helpers run as their owner (SECURITY DEFINER). Signed-out callers never need them:
--    only signed-in users (through the row rules) do. Remove the default "anyone can run" grant.
do $$
declare f text;
begin
  foreach f in array array[
    'core.access_role(text)', 'core.can_edit(text)', 'core.can_view(text)', 'core.granted_market(text)',
    'core.is_admin()', 'core.is_member()', 'core.viewable_markets()',
    'core.m_compset(uuid)', 'core.m_deal(uuid)', 'core.m_project(uuid)', 'core.m_property(uuid)',
    'public.is_data_publisher()'
  ] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
-- event-trigger helper: nobody calls this through the API
revoke execute on function public.rls_auto_enable() from public, anon, authenticated;

-- 2. Pin the search path on the remaining functions (they already use schema-qualified names;
--    PostGIS lives in "extensions").
do $$
declare f text;
begin
  foreach f in array array[
    'public.set_updated_at()', 'pipeline._num(text)', 'comps.nearest_market(double precision, double precision)',
    'comps.sale_comps_set_market()', 'comps.set_market_from_location()', 'core.norm_addr(text)', 'core.norm_name(text)',
    'core.property_candidates(text, text, double precision, double precision, integer, text, boolean)',
    'core.best_property(text, text, double precision, double precision, integer, text, boolean)',
    'pipeline.trg_deal_property()', 'comps.trg_comp_property()',
    'pipeline.record_sale(uuid, numeric, date, text, numeric, text, text, text, boolean, numeric)',
    'market.trg_dev_property()', 'market.trg_dev_property_cleanup()', 'market.trg_dev_track_log()', 'comps.fill_price_per_sf()'
  ] loop
    execute format('alter function %s set search_path = public, extensions', f);
  end loop;
end $$;

-- 3. "Hide a property" for editors: the rule applied to every role; it only ever passes for signed-in editors.
alter policy ma_insert_editors on core.properties_removed to authenticated;

-- 4. Old file store (market-data bucket: Denver/Phoenix JSON from the first version, not used by any page).
--    Any listed user could read it regardless of market. Admin only until it is deleted.
alter policy "members can read market data" on storage.objects using (bucket_id = 'market-data' and core.is_admin());

-- 5. Speed: read the signed-in email once per query instead of once per row.
alter policy ma_self on core.market_access
  using (lower(email) = lower(coalesce((select auth.jwt() ->> 'email'), '')) or (select core.is_admin()));

-- 6. Scheduler key for the daily website read (web-scrape checks it; only server-side code can read this table).
create table if not exists core.app_secrets (name text primary key, value text not null, created_at timestamptz default now());
alter table core.app_secrets enable row level security;
revoke all on core.app_secrets from public, anon, authenticated;
grant select on core.app_secrets to service_role;
grant select on core.market_access to service_role;   -- web-scrape checks the caller's edit rights
insert into core.app_secrets(name, value) values ('web_scrape_cron_key', encode(extensions.gen_random_bytes(24), 'hex')) on conflict (name) do nothing;
-- cron job web-scrape-daily now sends the key as an x-cron-key header (see cron.job; the key is read from core.app_secrets)
