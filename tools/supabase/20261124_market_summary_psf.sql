-- One row per market (sums and weights, so region totals add up exactly) for the Markets home page, so the browser doesn't pull every property.
-- Same rules as each market's Overview: team edits win over CoStar values; projects marked anything other than UC in the
-- pipeline are left out; existing figures are weighted by units, except asking rent per SF, which is weighted by square
-- feet (units × avg unit size; the market's average size when a property has none) so it equals total rent / total SF.
-- nc_*: concessions at Class A/B properties built in the last five years ("new construction").
-- security invoker: row-level security still decides which markets a person sees.
-- Nov 24 2026 review: replaces 20261123_market_summary.sql (which predates the nc_* columns); $/SF now weighted by SF.
create or replace function core.market_summary()
 returns table(market_id text, ex_n integer, ex_units numeric, uc_n integer, uc_units numeric, ask_x numeric, ask_w numeric, mo_x numeric, mo_w numeric, vac_x numeric, vac_w numeric, conc_x numeric, conc_w numeric, nc_x numeric, nc_w numeric, nc_n integer, comp_sets integer)
 language sql stable security invoker set search_path to ''
as $function$
  with x as (
    select p.market_id,
      coalesce(nullif(o.edits->>'status',''), p.status) st,
      coalesce(nullif(o.edits->>'units','')::numeric, p.units) u,
      coalesce(nullif(o.edits->>'pipelineStage',''), p.attrs->>'pipelineStage') stg,
      coalesce(nullif(o.edits->>'class',''), p.class) cls,
      coalesce(nullif(o.edits->>'yearBuilt','')::numeric, p.year_built) yb,
      coalesce(nullif(o.edits->>'avgAskingSF','')::numeric, nullif(p.attrs->>'avgAskingSF','')::numeric) ask,
      nullif(coalesce(nullif(o.edits->>'avgUnitSF','')::numeric, p.avg_unit_sf, nullif(p.attrs->>'avgUnitSF','')::numeric), 0) sf,
      coalesce(nullif(o.edits->>'avgAskingUnit','')::numeric, nullif(p.attrs->>'avgAskingUnit','')::numeric) mo,
      coalesce(nullif(o.edits->>'vacancy','')::numeric, nullif(p.attrs->>'vacancy','')::numeric) vac,
      coalesce(nullif(o.edits->>'concessions','')::numeric, nullif(p.attrs->>'concessions','')::numeric) conc
    from core.properties p
    left join market.property_overrides o on o.property_id = p.id
    where p.kind <> 'land'
  ), y as (select * from x where stg is null or stg = 'UC'),
  e0 as (select * from y where st = 'Existing' and u > 0),
  e as (select e0.*, u * coalesce(sf, sum(u * sf) filter (where sf is not null) over (partition by e0.market_id)
                                      / nullif(sum(u) filter (where sf is not null) over (partition by e0.market_id), 0), 1) sfw from e0),
  n as (select * from e where cls in ('A', 'B') and yb >= extract(year from now()) - 5 and conc is not null)
  select m.market_id,
    (select count(*) from y where y.market_id = m.market_id and st = 'Existing')::int,
    coalesce((select sum(u) from y where y.market_id = m.market_id and st = 'Existing'), 0),
    (select count(*) from y where y.market_id = m.market_id and st = 'Under Construction')::int,
    coalesce((select sum(u) from y where y.market_id = m.market_id and st = 'Under Construction'), 0),
    (select sum(ask * sfw) from e where e.market_id = m.market_id and ask is not null), (select sum(sfw) from e where e.market_id = m.market_id and ask is not null),
    (select sum(mo * u) from e where e.market_id = m.market_id and mo is not null), (select sum(u) from e where e.market_id = m.market_id and mo is not null),
    (select sum(vac * u) from e where e.market_id = m.market_id and vac is not null), (select sum(u) from e where e.market_id = m.market_id and vac is not null),
    (select sum(conc * u) from e where e.market_id = m.market_id and conc is not null), (select sum(u) from e where e.market_id = m.market_id and conc is not null),
    (select sum(conc * u) from n where n.market_id = m.market_id), (select sum(u) from n where n.market_id = m.market_id),
    (select count(*) from n where n.market_id = m.market_id)::int,
    (select count(*) from market.comp_sets c where c.market_id = m.market_id)::int
  from (select distinct market_id from y) m;
$function$;
grant execute on function core.market_summary() to authenticated;
