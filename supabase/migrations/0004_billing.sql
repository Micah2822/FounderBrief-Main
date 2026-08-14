-- Payment tiers: free (2 connectors) and founder ($19/month, all of them).
--
-- The tier lives on `user_settings` rather than in a table of its own for three
-- reasons. Every user already has exactly one row, created by the trigger in
-- `0002`, so there is no "billing row doesn't exist yet" case to handle
-- anywhere. Migration `0003` already grants service_role what it needs on this
-- table, and added columns inherit those grants — a new table would need its
-- own, and `0003` exists precisely because a missing grant once failed
-- silently. And the row already cascades from `auth.users`, so account deletion
-- stays complete without anyone remembering to add a foreign key.
--
-- Deliberately NOT stored here: subscription status, current period end,
-- cancel-at-period-end. The Stripe Customer Portal already shows all three, and
-- a local mirror of Stripe's state machine drifts from it. The app needs one
-- question answered — is this user paying — and `tier` answers it.
--
-- `if not exists` throughout because migrations are applied by hand and nothing
-- records which have run (ARCHITECTURE › Data model), so re-running a file has
-- to be safe.

alter table public.user_settings
  add column if not exists tier text not null default 'free'
    check (tier in ('free', 'founder')),
  add column if not exists stripe_customer_id text;

-- Two accounts must never claim the same Stripe customer: that is the failure
-- mode where one person's payment grants a different person's access.
--
-- It is also what makes the billing webhook's lookup a real tenant filter. That
-- route resolves the user by stripe_customer_id because Stripe events carry no
-- user_id, which trips `npm run check:scoping`; the exemption it gets there is
-- only sound while this index guarantees one customer maps to at most one user.
-- Dropping this index turns that exemption into a genuine cross-tenant read.
create unique index if not exists user_settings_stripe_customer_id_key
  on public.user_settings (stripe_customer_id)
  where stripe_customer_id is not null;
