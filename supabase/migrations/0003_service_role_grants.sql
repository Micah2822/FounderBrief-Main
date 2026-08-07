-- Grant table privileges to service_role.
--
-- The project is configured with "Automatically expose new tables: OFF", which
-- is the right setting — but it means tables created by 0001 were given no
-- privileges to any role at all. Enabling RLS and writing policies is not
-- enough: RLS filters rows for a role that already holds the table privilege,
-- so with no GRANT every write failed with
--
--   42501  permission denied for table integrations
--
-- The failure was silent end to end (the OAuth callback ignored the error and
-- redirected as though it had worked), so the only symptom was a Connect
-- button that never changed state.
--
-- Only service_role is granted. Every database read and write in the app goes
-- through createAdminClient() in a server route or server component; the
-- browser uses Supabase for authentication only and never queries a table
-- directly. Deliberately NOT granting `authenticated` or `anon` means no
-- browser-held key can reach these tables at all, which matters because
-- integrations.access_token holds encrypted third-party credentials. The RLS
-- policies in 0001 stay as defence in depth if a client-side read is ever
-- added.

grant usage on schema public to service_role;

-- Read-write: the server upserts and updates these during onboarding,
-- collection, and brief generation.
grant select, insert, update, delete on public.integrations   to service_role;
grant select, insert, update         on public.user_settings  to service_role;
grant select, insert, update         on public.daily_metrics  to service_role;
grant select, insert, update         on public.briefs         to service_role;
grant select, insert                 on public.chat_messages  to service_role;
grant select, insert                 on public.tool_requests  to service_role;

-- Anything added later by a migration run as this role should inherit the same
-- privileges, so a new table does not reintroduce the same silent failure.
alter default privileges in schema public
  grant select, insert, update, delete on tables to service_role;
