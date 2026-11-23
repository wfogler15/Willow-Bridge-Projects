-- Only people listed in core.market_access (Settings → People and access) can create a login.
-- Anyone else who asks for a sign-in code is refused before a code is sent; the sign-in page
-- shows "This email doesn't have access yet". Applies to Canopy and the Demo (same login system).
create or replace function core.block_unlisted_signup()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from core.market_access a where lower(a.email) = lower(new.email)) then
    raise exception 'NOT_ON_ACCESS_LIST' using errcode = 'P0001';
  end if;
  return new;
end
$$;

revoke execute on function core.block_unlisted_signup() from public, anon, authenticated;
grant usage on schema core to supabase_auth_admin;
grant execute on function core.block_unlisted_signup() to supabase_auth_admin;

drop trigger if exists wb_access_list_only on auth.users;
create trigger wb_access_list_only
  before insert on auth.users
  for each row execute function core.block_unlisted_signup();
