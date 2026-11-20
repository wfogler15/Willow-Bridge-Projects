-- Per-market access (Nov 20 2026)
-- Who can see / edit which market. Replaces "on the data_publishers list = everything".
--   role  view  : read that market
--         edit  : read + write that market (uploads, comp sets, edits)
--         admin : edit + create markets + manage access (only meaningful on market '*')
--   market_id '*' = every market, including ones added later.
-- Tables with a market_id are checked on that column; child tables are checked through their parent
-- (property, comp set, Radar project, deal). Rows with no market are visible to '*' holders only.

-- 1) access list
create table if not exists core.market_access (
  email      text not null,
  market_id  text not null,           -- a core.markets id, or '*'
  role       text not null check (role in ('view', 'edit', 'admin')),
  note       text,
  created_at timestamptz not null default now(),
  primary key (email, market_id)
);
alter table core.market_access enable row level security;
grant select, insert, update, delete on core.market_access to authenticated;

-- everyone on today's list keeps today's reach
insert into core.market_access (email, market_id, role, note) values
  ('wfogler@willowbridgepc.com', '*', 'admin', 'owner'),
  ('npatel@willowbridgepc.com',  '*', 'edit',  'Denver/Phoenix team')
on conflict do nothing;

-- 2) checks (security definer: they read the access list and parent rows regardless of the caller's own rights)
create or replace function core.access_role(p_market text) returns text
language sql stable security definer set search_path to '' as $$
  select case max(case a.role when 'admin' then 3 when 'edit' then 2 else 1 end)
           when 3 then 'admin' when 2 then 'edit' when 1 then 'view' end
  from core.market_access a
  where lower(a.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
    and (a.market_id = '*' or a.market_id = p_market)
$$;
create or replace function core.can_view(p_market text) returns boolean language sql stable security definer set search_path to '' as $$ select core.access_role(p_market) is not null $$;
create or replace function core.can_edit(p_market text) returns boolean language sql stable security definer set search_path to '' as $$ select core.access_role(p_market) in ('edit', 'admin') $$;
create or replace function core.is_admin() returns boolean language sql stable security definer set search_path to '' as $$
  select exists (select 1 from core.market_access a where lower(a.email) = lower(coalesce(auth.jwt() ->> 'email', '')) and a.market_id = '*' and a.role = 'admin') $$;
-- signed in and on the list for at least one market (login gate; tables with no market)
create or replace function core.is_member() returns boolean language sql stable security definer set search_path to '' as $$
  select exists (select 1 from core.market_access a where lower(a.email) = lower(coalesce(auth.jwt() ->> 'email', ''))) $$;

-- parent → market
create or replace function core.m_property(p uuid) returns text language sql stable security definer set search_path to '' as $$ select market_id from core.properties where id = p $$;
create or replace function core.m_compset(p uuid) returns text language sql stable security definer set search_path to '' as $$ select market_id from market.comp_sets where id = p $$;
create or replace function core.m_project(p uuid) returns text language sql stable security definer set search_path to '' as $$ select market_id from market.dev_projects where id = p $$;
create or replace function core.m_deal(p uuid) returns text language sql stable security definer set search_path to '' as $$ select market_id from pipeline.deals where id = p $$;

-- 3) policies
do $$
declare
  t record;
  direct text[] := array['core.properties','core.properties_removed','core.parcels','core.pois','comps.sale_comps',
    'market.rp_property_data','market.rp_trends','market.comp_sets','market.dev_projects','market.weekly_highlights',
    'pipeline.deals','pipeline.meeting_agenda'];
  child text[][] := array[
    ['market.property_snapshots','core.m_property(property_id)'], ['market.property_overrides','core.m_property(property_id)'],
    ['market.comp_fees','core.m_property(property_id)'], ['market.comp_set_members','core.m_compset(comp_set_id)'],
    ['market.comp_set_sales','core.m_compset(comp_set_id)'], ['market.dev_events','core.m_project(project_id)'],
    ['pipeline.deal_log','core.m_deal(deal_id)'], ['pipeline.deal_parcels','core.m_deal(deal_id)']];
  tbl text; expr text; i int;
begin
  -- drop the old all-or-nothing policies on these tables
  for t in select schemaname, tablename, policyname from pg_policies
           where schemaname || '.' || tablename = any (direct || array(select child[k][1] from generate_subscripts(child, 1) k) || array['core.markets','core.market_access'])
  loop
    execute format('drop policy %I on %I.%I', t.policyname, t.schemaname, t.tablename);
  end loop;

  foreach tbl in array direct loop
    execute format('create policy ma_select on %s for select to authenticated using (core.can_view(market_id))', tbl);
    execute format('create policy ma_insert on %s for insert to authenticated with check (core.can_edit(market_id))', tbl);
    execute format('create policy ma_update on %s for update to authenticated using (core.can_edit(market_id)) with check (core.can_edit(market_id))', tbl);
    execute format('create policy ma_delete on %s for delete to authenticated using (core.can_edit(market_id))', tbl);
  end loop;
  -- the cleanup list is changed by admins only
  execute 'drop policy ma_insert on core.properties_removed'; execute 'drop policy ma_update on core.properties_removed'; execute 'drop policy ma_delete on core.properties_removed';
  execute 'create policy ma_admin on core.properties_removed for all to authenticated using (core.is_admin()) with check (core.is_admin())';

  for i in 1 .. array_length(child, 1) loop
    tbl := child[i][1]; expr := child[i][2];
    execute format('create policy ma_select on %s for select to authenticated using (core.can_view(%s))', tbl, expr);
    execute format('create policy ma_insert on %s for insert to authenticated with check (core.can_edit(%s))', tbl, expr);
    execute format('create policy ma_update on %s for update to authenticated using (core.can_edit(%s)) with check (core.can_edit(%s))', tbl, expr, expr);
    execute format('create policy ma_delete on %s for delete to authenticated using (core.can_edit(%s))', tbl, expr);
  end loop;

  -- markets: see the ones you have; an editor can update their market's settings (an upload moves its as-of date); admins add and remove markets
  execute 'create policy ma_select on core.markets for select to authenticated using (core.can_view(id))';
  execute 'create policy ma_update on core.markets for update to authenticated using (core.can_edit(id)) with check (core.can_edit(id))';
  execute 'create policy ma_admin_ins on core.markets for insert to authenticated with check (core.is_admin())';
  execute 'create policy ma_admin_del on core.markets for delete to authenticated using (core.is_admin())';

  -- access list: you can see your own rows; admins see and change all
  execute 'create policy ma_self on core.market_access for select to authenticated using (lower(email) = lower(coalesce(auth.jwt() ->> ''email'', '''')) or core.is_admin())';
  execute 'create policy ma_admin on core.market_access for all to authenticated using (core.is_admin()) with check (core.is_admin())';
end $$;

-- Add a person (they then sign in on the dashboard with that email: password or emailed code):
--   insert into core.market_access (email, market_id, role, note) values ('jacob@willowbridgepc.com', 'fort_lauderdale', 'edit', 'Florida analyst');
-- Remove:  delete from core.market_access where email = 'jacob@willowbridgepc.com';
