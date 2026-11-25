-- Nov 24 2026: retire v1 leftovers (approved by Will).
-- v1 tables: moved out of the API into a private backup schema (no access for site users); drop after Dec 31 2026.
create schema if not exists backup_v1;
revoke all on schema backup_v1 from public, anon, authenticated;
comment on schema backup_v1 is 'v1 tables retired Nov 24 2026 (data already copied into core/market). Not reachable from the site. Safe to drop after Dec 31 2026.';
alter table public.comp_fees set schema backup_v1;
alter table public.comp_sets set schema backup_v1;
alter table public.custom_comps set schema backup_v1;
alter table public.custom_properties set schema backup_v1;
alter table public.opportunities set schema backup_v1;
alter table public.pois set schema backup_v1;
alter table public.property_edits set schema backup_v1;
alter table public.property_edits_archive set schema backup_v1;
alter table public.sale_comp_edits set schema backup_v1;
-- exact copy already in market.property_snapshots (687 of 687 matched)
drop table public.property_snapshots;
-- old file store ("market-data" bucket, emptied and removed through the Storage API) and its publisher list
drop policy if exists "members can read market data" on storage.objects;
drop policy if exists "publishers can delete market data" on storage.objects;
drop policy if exists "publishers can replace market data" on storage.objects;
drop policy if exists "publishers can upload market data" on storage.objects;
alter table public.data_publishers set schema backup_v1;
drop function if exists public.is_data_publisher();
-- one-time load staging (already loaded into the real tables)
drop table staging.blobs;
drop table staging.load_token;
drop schema if exists staging;
-- public.refresh_log stays (uploads write to it).
-- Edge functions one-time-loader and web-probe now only answer 410; delete them in the dashboard (Edge Functions → ⋯ → Delete).
