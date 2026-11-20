-- Canopy-only data is Will's alone (Nov 20 2026). Applied live; kept here as the record.
-- Opportunities, deal log, parcels (Site Scout), Radar (projects, events, This week), meeting agenda, POIs, review queue:
-- only core.is_admin() (Will, market_access '*' admin) can read or write. The Demo doesn't read any of these.
alter view core.property_events set (security_invoker = true);   -- the history view now obeys the callers' rights (it ran as owner and showed every market's deals)
do $$
declare t record; tbl text;
  canopy text[] := array['pipeline.deals','pipeline.deal_log','pipeline.deal_parcels','pipeline.meeting_agenda','market.dev_projects','market.dev_events','market.weekly_highlights','core.parcels','core.pois','core.review_queue'];
begin
  for t in select schemaname, tablename, policyname from pg_policies where schemaname||'.'||tablename = any (canopy) loop
    execute format('drop policy %I on %I.%I', t.policyname, t.schemaname, t.tablename);
  end loop;
  foreach tbl in array canopy loop
    execute format('create policy canopy_owner on %s for all to authenticated using (core.is_admin()) with check (core.is_admin())', tbl);
  end loop;
end $$;
-- To give someone Canopy access again, they need admin on '*' in core.market_access (or loosen these policies).
