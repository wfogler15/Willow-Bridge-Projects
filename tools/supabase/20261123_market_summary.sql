-- One row per market (sums and unit weights, so region totals add up exactly) for the Markets home page, so the browser doesn't pull every property.
-- Same rules as each market's Overview: team edits win over CoStar values; projects marked anything
-- other than UC in the pipeline are left out; existing figures are weighted by units.
-- security invoker: row-level security still decides which markets a person sees.
drop function if exists core.market_summary();
create function core.market_summary()
returns table (market_id text, ex_n int, ex_units numeric, uc_n int, uc_units numeric,
               ask_x numeric, ask_w numeric, mo_x numeric, mo_w numeric, vac_x numeric, vac_w numeric, conc_x numeric, conc_w numeric, comp_sets int)
language sql stable security invoker set search_path = '' as $$
  with x as (
    select p.market_id,
      coalesce(nullif(o.edits->>'status',''), p.status) st,
      coalesce(nullif(o.edits->>'units','')::numeric, p.units) u,
      coalesce(nullif(o.edits->>'pipelineStage',''), p.attrs->>'pipelineStage') stg,
      coalesce(nullif(o.edits->>'avgAskingSF','')::numeric, nullif(p.attrs->>'avgAskingSF','')::numeric) ask,
      coalesce(nullif(o.edits->>'avgAskingUnit','')::numeric, nullif(p.attrs->>'avgAskingUnit','')::numeric) mo,
      coalesce(nullif(o.edits->>'vacancy','')::numeric, nullif(p.attrs->>'vacancy','')::numeric) vac,
      coalesce(nullif(o.edits->>'concessions','')::numeric, nullif(p.attrs->>'concessions','')::numeric) conc
    from core.properties p
    left join market.property_overrides o on o.property_id = p.id
    where p.kind <> 'land'
  ), y as (select * from x where stg is null or stg = 'UC'),
  e as (select * from y where st = 'Existing' and u > 0)
  select m.market_id,
    (select count(*) from y where y.market_id = m.market_id and st = 'Existing')::int,
    coalesce((select sum(u) from y where y.market_id = m.market_id and st = 'Existing'), 0),
    (select count(*) from y where y.market_id = m.market_id and st = 'Under Construction')::int,
    coalesce((select sum(u) from y where y.market_id = m.market_id and st = 'Under Construction'), 0),
    (select sum(ask * u) from e where e.market_id = m.market_id and ask is not null), (select sum(u) from e where e.market_id = m.market_id and ask is not null),
    (select sum(mo * u) from e where e.market_id = m.market_id and mo is not null), (select sum(u) from e where e.market_id = m.market_id and mo is not null),
    (select sum(vac * u) from e where e.market_id = m.market_id and vac is not null), (select sum(u) from e where e.market_id = m.market_id and vac is not null),
    (select sum(conc * u) from e where e.market_id = m.market_id and conc is not null), (select sum(u) from e where e.market_id = m.market_id and conc is not null),
    (select count(*) from market.comp_sets c where c.market_id = m.market_id)::int
  from (select distinct market_id from y) m;
$$;
grant execute on function core.market_summary() to authenticated;
