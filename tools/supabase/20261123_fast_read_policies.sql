-- Faster reads. The read rules called core.can_view() once per row (about 0.3 ms each, so ~0.7 s for a market's
-- properties). Same rule, checked once per request: the markets this login can view, as a list.
-- '*' in the list means every market. Write rules (can_edit) are unchanged.
create or replace function core.viewable_markets()
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(distinct a.market_id), '{}')
  from core.market_access a
  where lower(a.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
$$;
revoke execute on function core.viewable_markets() from public, anon;
grant execute on function core.viewable_markets() to authenticated;

-- tables with a market_id
drop policy if exists ma_select on core.properties;
create policy ma_select on core.properties for select to authenticated
  using ('*' = any ((select core.viewable_markets())::text[]) or market_id = any ((select core.viewable_markets())::text[]));
drop policy if exists ma_select on market.rp_property_data;
create policy ma_select on market.rp_property_data for select to authenticated
  using ('*' = any ((select core.viewable_markets())::text[]) or market_id = any ((select core.viewable_markets())::text[]));
drop policy if exists ma_select on market.rp_trends;
create policy ma_select on market.rp_trends for select to authenticated
  using ('*' = any ((select core.viewable_markets())::text[]) or market_id = any ((select core.viewable_markets())::text[]));
drop policy if exists ma_select on comps.sale_comps;
create policy ma_select on comps.sale_comps for select to authenticated
  using ('*' = any ((select core.viewable_markets())::text[]) or market_id = any ((select core.viewable_markets())::text[]));
drop policy if exists ma_select on market.comp_sets;
create policy ma_select on market.comp_sets for select to authenticated
  using ('*' = any ((select core.viewable_markets())::text[]) or market_id = any ((select core.viewable_markets())::text[]));
drop policy if exists ma_select on core.properties_removed;
create policy ma_select on core.properties_removed for select to authenticated
  using ('*' = any ((select core.viewable_markets())::text[]) or market_id = any ((select core.viewable_markets())::text[]));

-- tables keyed by property (market looked up per row only when the login doesn't see every market)
drop policy if exists ma_select on market.comp_fees;
create policy ma_select on market.comp_fees for select to authenticated
  using ('*' = any ((select core.viewable_markets())::text[]) or core.m_property(property_id) = any ((select core.viewable_markets())::text[]));
drop policy if exists ma_select on market.property_overrides;
create policy ma_select on market.property_overrides for select to authenticated
  using ('*' = any ((select core.viewable_markets())::text[]) or core.m_property(property_id) = any ((select core.viewable_markets())::text[]));
drop policy if exists ma_select on market.property_snapshots;
create policy ma_select on market.property_snapshots for select to authenticated
  using ('*' = any ((select core.viewable_markets())::text[]) or core.m_property(property_id) = any ((select core.viewable_markets())::text[]));

-- tables keyed by comp set
drop policy if exists ma_select on market.comp_set_members;
create policy ma_select on market.comp_set_members for select to authenticated
  using ('*' = any ((select core.viewable_markets())::text[]) or core.m_compset(comp_set_id) = any ((select core.viewable_markets())::text[]));
drop policy if exists ma_select on market.comp_set_sales;
create policy ma_select on market.comp_set_sales for select to authenticated
  using ('*' = any ((select core.viewable_markets())::text[]) or core.m_compset(comp_set_id) = any ((select core.viewable_markets())::text[]));

-- properties come back ordered by CoStar id in pages of 1,000: an index in that order avoids re-sorting on disk for every page
create index if not exists properties_market_costar_idx on core.properties (market_id, costar_id);
