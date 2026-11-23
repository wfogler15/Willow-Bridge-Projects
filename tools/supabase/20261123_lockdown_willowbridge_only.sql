-- Willow Bridge only.
-- 1. The access list (Settings → People and access) only accepts @willowbridgepc.com emails.
alter table core.market_access drop constraint if exists market_access_wb_email;
alter table core.market_access add constraint market_access_wb_email
  check (lower(email) like '%@willowbridgepc.com');

-- 2. Logins: only @willowbridgepc.com emails that are on the access list (belt and braces with 1).
create or replace function core.block_unlisted_signup()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if lower(coalesce(new.email, '')) not like '%@willowbridgepc.com'
     or not exists (select 1 from core.market_access a where lower(a.email) = lower(new.email)) then
    raise exception 'NOT_ON_ACCESS_LIST' using errcode = 'P0001';
  end if;
  return new;
end
$$;

-- 3. Old uploaded data files (storage bucket market-data): only people on the access list can read them,
--    not any signed-in login.
drop policy if exists "authenticated can read market data" on storage.objects;
create policy "members can read market data" on storage.objects
  for select to authenticated
  using (bucket_id = 'market-data' and core.is_member());

-- 4. The publisher email list: admins only.
drop policy if exists "authenticated can read publisher list" on public.data_publishers;
create policy "admins read publisher list" on public.data_publishers
  for select to authenticated
  using (core.is_admin());
