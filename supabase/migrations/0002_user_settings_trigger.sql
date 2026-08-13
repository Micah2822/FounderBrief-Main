-- Create the user_settings row for every new user, in the database.
--
-- The nightly cron selects who to send briefs to by querying user_settings
-- (app/api/cron/hourly/route.ts), so a user without a row silently receives
-- nothing — no error, no log line. Previously the row was created in the web
-- sign-in callback, which meant any user created another way (dashboard
-- "Invite user", the admin API, or a client-side OTP verification that never
-- touches a server route) was born broken. A trigger closes that off.
--
-- Note: this creates a trigger on the `auth` schema, so it must be run with
-- sufficient privileges — the Supabase SQL editor does this by default.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.user_settings (user_id)
  values (new.id)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

-- Postgres grants EXECUTE on a new function to PUBLIC by default, and
-- PostgREST publishes anything in the `public` schema — which together would
-- expose this SECURITY DEFINER function unauthenticated at
-- /rest/v1/rpc/handle_new_user. Revoke it: a trigger executes as the table
-- owner and never consults EXECUTE privileges, so the grant buys nothing and
-- removing it does not affect signup.
revoke execute on function public.handle_new_user() from public, anon, authenticated;

drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Backfill anyone who predates the trigger.
insert into public.user_settings (user_id)
select id from auth.users
on conflict (user_id) do nothing;
