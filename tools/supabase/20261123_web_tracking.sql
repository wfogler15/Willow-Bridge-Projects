-- Property website tracking (Nov 23). An editor turns tracking on from a property card with the site's URL,
-- how often and until when. A scheduled Supabase function (web-scrape) reads each due site and saves a snapshot.
-- Snapshots are written only by that function (service role); people read them under the usual market rules.
create table if not exists market.web_tracks (
  id           uuid primary key default gen_random_uuid(),
  property_id  uuid not null references core.properties(id) on delete cascade,
  market_id    text not null references core.markets(id) on delete cascade,
  url          text not null check (url ~* '^https://'),
  platform     text,                       -- detected on first run: greystar, rentcafe, ...
  frequency    text not null default 'daily' check (frequency in ('daily','weekly')),
  until        date,                       -- stop after this date (null = until stop_at_occ)
  stop_at_occ  numeric default 95,         -- stop once CoStar/hand occupancy reaches this
  enabled      boolean not null default true,
  created_by   text default lower(coalesce(auth.jwt() ->> 'email', 'system')),
  created_at   timestamptz not null default now(),
  last_run_at  timestamptz,
  last_ok_at   timestamptz,
  last_error   text,
  unique (property_id)
);

create table if not exists market.web_snapshots (
  id           bigint generated always as identity primary key,
  track_id     uuid not null references market.web_tracks(id) on delete cascade,
  property_id  uuid not null references core.properties(id) on delete cascade,
  market_id    text not null,
  scraped_at   timestamptz not null default now(),
  ok           boolean not null,
  units        jsonb,      -- [{unit, plan, beds, baths, sf, rent, available}]
  specials     text,       -- the site's promotion text, as written
  weeks_free   numeric,    -- weeks free read from that text, when it states one
  summary      jsonb,      -- {available, byBeds:{0:{n,rent,sf,psf},1:...}, rent, sf, psf}
  error        text
);
create index if not exists web_snapshots_track_idx on market.web_snapshots (track_id, scraped_at desc);

alter table market.web_tracks enable row level security;
alter table market.web_snapshots enable row level security;
grant select, insert, update, delete on market.web_tracks to authenticated;
grant select on market.web_snapshots to authenticated;

create policy wt_select on market.web_tracks for select to authenticated
  using ('*' = any ((select core.viewable_markets())::text[]) or market_id = any ((select core.viewable_markets())::text[]));
create policy wt_insert on market.web_tracks for insert to authenticated with check (core.can_edit(market_id));
create policy wt_update on market.web_tracks for update to authenticated using (core.can_edit(market_id)) with check (core.can_edit(market_id));
create policy wt_delete on market.web_tracks for delete to authenticated using (core.can_edit(market_id));
create policy ws_select on market.web_snapshots for select to authenticated
  using ('*' = any ((select core.viewable_markets())::text[]) or market_id = any ((select core.viewable_markets())::text[]));
