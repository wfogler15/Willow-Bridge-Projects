-- Lock the old (pre-October) public tables. Nothing is deleted; the data stays, readable only by the database owner.
-- Every manual edit in them is already in the new tables (checked Nov 20 2026).
-- Run in the Supabase SQL editor (project wmydniiakotcliraajaa). Safe to run twice.
do $$
declare t record; tbl text;
  old text[] := array['opportunities','property_edits','custom_comps','sale_comp_edits','comp_sets','custom_properties','comp_fees','property_snapshots','property_edits_archive','refresh_log','pois'];
begin
  for t in select tablename, policyname from pg_policies where schemaname='public' and tablename = any (old) loop
    execute format('drop policy %I on public.%I', t.policyname, t.tablename);
  end loop;
  foreach tbl in array old loop
    execute format('alter table public.%I enable row level security', tbl);
    execute format('revoke all on public.%I from anon', tbl);
  end loop;
  -- the upload log stays usable by signed-in members (the uploader writes one line per load)
  execute 'create policy members_read on public.refresh_log for select to authenticated using (core.is_member())';
  execute 'create policy members_insert on public.refresh_log for insert to authenticated with check (core.is_member())';
end $$;

-- Check: should list only members_read / members_insert on refresh_log, and anon_sel false everywhere
select tablename, policyname from pg_policies where schemaname = 'public' order by 1;
select has_table_privilege('anon', 'public.opportunities', 'select') as anon_can_read_opportunities;
