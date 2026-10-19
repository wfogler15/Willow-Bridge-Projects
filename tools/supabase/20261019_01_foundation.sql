-- Willow Bridge Intel: foundation schemas (Phase 2)
-- New sections core / market / pipeline / comps, alongside the legacy public tables (untouched).

create extension if not exists postgis with schema extensions;

create schema if not exists core;
create schema if not exists market;
create schema if not exists pipeline;
create schema if not exists comps;

-- ---------- helpers ----------
-- Who may sign in: emails on public.data_publishers (the existing allowlist).
create or replace function core.is_member() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.data_publishers p
    where lower(p.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

-- Who made a change: the signed-in email, else 'claude' (connector / service writes).
create or replace function core.actor() returns text
language sql stable set search_path = '' as $$
  select coalesce(nullif(auth.jwt() ->> 'email', ''), 'claude');
$$;

create or replace function core.touch() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  new.updated_by := core.actor();
  return new;
end $$;

-- ---------- core ----------
create table core.markets (
  id          text primary key,                 -- 'denver', 'phoenix', 'portland'
  label       text not null,                    -- 'Denver, CO'
  title       text,
  config      jsonb not null default '{}',      -- submarket lists, mappings, density rules, forecast anchor
  created_at  timestamptz not null default now(),
  created_by  text not null default core.actor(),
  updated_at  timestamptz not null default now(),
  updated_by  text not null default core.actor()
);

create table core.properties (
  id               uuid primary key default gen_random_uuid(),
  market_id        text not null references core.markets(id),
  kind             text not null check (kind in ('existing','under_construction','proposed','land')),
  name             text,
  address          text,
  city             text,
  state            text,
  zip              text,
  lat              double precision,
  lng              double precision,
  geom             extensions.geography(Point, 4326)
                   generated always as (
                     case when lat is not null and lng is not null
                          then extensions.st_setsrid(extensions.st_makepoint(lng, lat), 4326)::extensions.geography end
                   ) stored,
  units            integer,
  year_built       integer,
  month_built      integer,
  stories          integer,
  avg_unit_sf      numeric,
  acres            numeric,
  land_sf          numeric,
  star_rating      integer,
  class            text,
  style            text,
  status           text,                        -- CoStar status as delivered
  owner            text,
  manager          text,
  developer        text,
  costar_id        text unique,
  realpage_id      text,
  costar_submarket text,
  wb_submarket     text,
  attrs            jsonb not null default '{}', -- remaining CoStar fields
  source           text not null default 'manual',
  created_at       timestamptz not null default now(),
  created_by       text not null default core.actor(),
  updated_at       timestamptz not null default now(),
  updated_by       text not null default core.actor()
);
create index properties_market_idx on core.properties (market_id);
create index properties_geom_idx   on core.properties using gist (geom);
create index properties_rp_idx     on core.properties (realpage_id);

create table core.parcels (
  id           uuid primary key default gen_random_uuid(),
  market_id    text not null references core.markets(id),
  county       text not null,
  apn          text not null,
  acres        numeric,
  geom         extensions.geometry(Geometry, 4326),
  property_id  uuid references core.properties(id) on delete set null,
  attrs        jsonb not null default '{}',
  created_at   timestamptz not null default now(),
  created_by   text not null default core.actor(),
  updated_at   timestamptz not null default now(),
  updated_by   text not null default core.actor(),
  unique (county, apn)
);
create index parcels_property_idx on core.parcels (property_id);
create index parcels_geom_idx     on core.parcels using gist (geom);

create table core.pois (
  id          text primary key,
  market_id   text not null references core.markets(id),
  category    text,
  name        text,
  lat         double precision,
  lng         double precision,
  geom        extensions.geography(Point, 4326)
              generated always as (
                case when lat is not null and lng is not null
                     then extensions.st_setsrid(extensions.st_makepoint(lng, lat), 4326)::extensions.geography end
              ) stored,
  data        jsonb not null default '{}',
  created_at  timestamptz not null default now(),
  created_by  text not null default core.actor(),
  updated_at  timestamptz not null default now(),
  updated_by  text not null default core.actor()
);
create index pois_geom_idx on core.pois using gist (geom);

-- Possible duplicates and conflicts for Will to settle (merge or keep separate).
create table core.review_queue (
  id           bigint generated always as identity primary key,
  kind         text not null check (kind in ('deal','comp','property','other')),
  reason       text not null,
  record_ids   jsonb not null default '[]',     -- ids of the records involved
  detail       jsonb not null default '{}',     -- the conflicting values, side by side
  status       text not null default 'open' check (status in ('open','merged','kept_separate','fixed','dismissed')),
  resolution   text,
  created_at   timestamptz not null default now(),
  created_by   text not null default core.actor(),
  updated_at   timestamptz not null default now(),
  updated_by   text not null default core.actor()
);

-- ---------- market ----------
create table market.property_snapshots (
  id           bigint generated always as identity primary key,
  property_id  uuid not null references core.properties(id) on delete cascade,
  period       text not null,                   -- 'Q2 2026'
  period_sort  integer not null,                -- 202602
  data         jsonb not null,                  -- rents by unit type ($/SF and $/mo), vacancy, concessions, etc.
  created_at   timestamptz not null default now(),
  created_by   text not null default core.actor(),
  updated_at   timestamptz not null default now(),
  updated_by   text not null default core.actor(),
  unique (property_id, period_sort)
);

create table market.property_overrides (
  property_id  uuid primary key references core.properties(id) on delete cascade,
  edits        jsonb not null default '{}',     -- field -> value, applied over each CoStar refresh
  created_at   timestamptz not null default now(),
  created_by   text not null default core.actor(),
  updated_at   timestamptz not null default now(),
  updated_by   text not null default core.actor()
);

create table market.rp_property_data (
  property_id  uuid primary key references core.properties(id) on delete cascade,
  realpage_id  text,
  data         jsonb not null,                  -- RealPage property record + rent history
  created_at   timestamptz not null default now(),
  created_by   text not null default core.actor(),
  updated_at   timestamptz not null default now(),
  updated_by   text not null default core.actor()
);

create table market.rp_trends (
  market_id    text not null references core.markets(id),
  geography    text not null,                   -- 'Market', MSA name, or RealPage submarket
  data         jsonb not null,                  -- year -> metrics (history + forecast)
  created_at   timestamptz not null default now(),
  created_by   text not null default core.actor(),
  updated_at   timestamptz not null default now(),
  updated_by   text not null default core.actor(),
  primary key (market_id, geography)
);

create table market.comp_fees (
  property_id  uuid primary key references core.properties(id) on delete cascade,
  fees         jsonb not null default '{}',
  created_at   timestamptz not null default now(),
  created_by   text not null default core.actor(),
  updated_at   timestamptz not null default now(),
  updated_by   text not null default core.actor()
);

-- ---------- pipeline ----------
create table pipeline.deals (
  id               uuid primary key default gen_random_uuid(),
  property_id      uuid references core.properties(id) on delete set null,
  market_id        text not null references core.markets(id),
  name             text not null,
  kind             text not null check (kind in ('land','asset')),
  stage            text not null default 'prospect' check (stage in
                     ('prospect','screening','underwriting','loi','under_contract','closed',
                      'monitor','passed','lost','dead')),
  address          text,
  lat              double precision,
  lng              double precision,
  geom             extensions.geography(Point, 4326)
                   generated always as (
                     case when lat is not null and lng is not null
                          then extensions.st_setsrid(extensions.st_makepoint(lng, lat), 4326)::extensions.geography end
                   ) stored,
  guidance         numeric,                     -- $
  guidance_note    text,                        -- 'Unpriced', 'Not set'
  bid_date         date,
  broker           text,
  broker_contact   text,
  seller           text,
  owner_of_record  text,
  units            integer,
  acres            numeric,
  zoning           text,
  entitlement      text,
  uw               jsonb not null default '{}', -- underwriting numbers (land: rent $/SF, ROC, req. rent; asset: NOI, occ., trade-outs ...)
  summary          text,
  take             text,                        -- our take
  outcome_winner   text,
  outcome_price    numeric,
  outcome_date     date,
  check_back_on    date,
  folder_path      text,
  legacy           jsonb not null default '{}', -- source ids from Site Scout / opportunities / deal report
  created_at       timestamptz not null default now(),
  created_by       text not null default core.actor(),
  updated_at       timestamptz not null default now(),
  updated_by       text not null default core.actor()
);
create index deals_market_idx   on pipeline.deals (market_id);
create index deals_property_idx on pipeline.deals (property_id);
create index deals_geom_idx     on pipeline.deals using gist (geom);

create table pipeline.deal_parcels (
  deal_id    uuid not null references pipeline.deals(id) on delete cascade,
  parcel_id  uuid not null references core.parcels(id) on delete cascade,
  primary key (deal_id, parcel_id)
);

create table pipeline.deal_log (
  id          bigint generated always as identity primary key,
  deal_id     uuid not null references pipeline.deals(id) on delete cascade,
  logged_on   date not null default current_date,
  kind        text not null default 'note' check (kind in ('note','stage','outcome')),
  body        text not null,
  created_at  timestamptz not null default now(),
  created_by  text not null default core.actor(),
  updated_at  timestamptz not null default now(),
  updated_by  text not null default core.actor()
);
create index deal_log_deal_idx on pipeline.deal_log (deal_id, logged_on desc);

create table market.comp_sets (
  id           uuid primary key default gen_random_uuid(),
  market_id    text not null references core.markets(id),
  name         text not null,
  description  text,
  deal_id      uuid references pipeline.deals(id) on delete set null,
  legacy_id    text,
  created_at   timestamptz not null default now(),
  created_by   text not null default core.actor(),
  updated_at   timestamptz not null default now(),
  updated_by   text not null default core.actor()
);

create table market.comp_set_members (
  comp_set_id  uuid not null references market.comp_sets(id) on delete cascade,
  property_id  uuid not null references core.properties(id) on delete cascade,
  sort         integer,
  primary key (comp_set_id, property_id)
);

-- ---------- comps ----------
create table comps.sale_comps (
  id                 uuid primary key default gen_random_uuid(),
  property_id        uuid references core.properties(id) on delete set null,
  market_id          text not null references core.markets(id),
  comp_type          text not null check (comp_type in ('investment','land')),
  name               text,
  address            text,
  city               text,
  submarket          text,
  lat                double precision,
  lng                double precision,
  geom               extensions.geography(Point, 4326)
                     generated always as (
                       case when lat is not null and lng is not null
                            then extensions.st_setsrid(extensions.st_makepoint(lng, lat), 4326)::extensions.geography end
                     ) stored,
  sale_date          date,
  sale_price         numeric,
  units              integer,                   -- existing units (investment)
  proposed_units     integer,                   -- land
  acres              numeric,
  year_built         integer,
  product_type       text,
  construction_type  text,
  price_per_unit     numeric,
  price_per_sf       numeric,
  price_per_land_sf  numeric,
  cap_rate           numeric,                   -- percent, e.g. 5.2
  buyer              text,
  seller             text,
  broker             text,
  notes              text,
  source             text not null default 'manual'
                     check (source in ('costar','broker','article','site_scout','manual','claude')),
  source_url         text,
  verified           boolean not null default false,
  legacy             jsonb not null default '{}',
  created_at         timestamptz not null default now(),
  created_by         text not null default core.actor(),
  updated_at         timestamptz not null default now(),
  updated_by         text not null default core.actor()
);
create index sale_comps_market_idx on comps.sale_comps (market_id, comp_type, sale_date desc);
create index sale_comps_geom_idx   on comps.sale_comps using gist (geom);

-- ---------- updated_at / updated_by triggers ----------
do $$
declare t record;
begin
  for t in
    select table_schema, table_name from information_schema.columns
    where table_schema in ('core','market','pipeline','comps') and column_name = 'updated_at'
  loop
    execute format('create trigger touch before update on %I.%I for each row execute function core.touch()',
                   t.table_schema, t.table_name);
  end loop;
end $$;

-- ---------- access: signed-in allowlisted users only ----------
revoke all on schema core, market, pipeline, comps from anon, public;
grant usage on schema core, market, pipeline, comps to authenticated, service_role;
grant select, insert, update, delete on all tables in schema core, market, pipeline, comps to authenticated;
grant all on all tables in schema core, market, pipeline, comps to service_role;
grant usage, select on all sequences in schema core, market, pipeline, comps to authenticated, service_role;
grant execute on function core.is_member(), core.actor() to authenticated, service_role;

do $$
declare t record;
begin
  for t in
    select schemaname, tablename from pg_tables
    where schemaname in ('core','market','pipeline','comps')
  loop
    execute format('alter table %I.%I enable row level security', t.schemaname, t.tablename);
    execute format('create policy members_all on %I.%I for all to authenticated using (core.is_member()) with check (core.is_member())',
                   t.schemaname, t.tablename);
  end loop;
end $$;

-- ---------- seed markets ----------
insert into core.markets (id, label, title) values
  ('denver',   'Denver, CO',   'Denver MSA'),
  ('phoenix',  'Phoenix, AZ',  'Phoenix MSA'),
  ('portland', 'Portland, OR', 'Portland MSA');
