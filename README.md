# Founder Brief

**What happened in my startup yesterday, and what should I focus on today?**

A daily brief for early-stage founders. Not a dashboard — a 30-second morning
read built from your GitHub and your product's Supabase database, delivered on
one page and one email. Works long before revenue exists.

## How it works

```
nightly (per user, at their send hour)
  collect  GitHub → merged PRs, commits, deploys, open PRs
  collect  Supabase → new signups (a table + timestamp column YOU map)
  collect  Plausible → website visitors, pageviews, top referral sources
  collect  Stripe → gross revenue, new customers (restricted read-only key)
  diff     deterministic engine → deltas, streaks, gaps   ← all numbers born here
  polish   OpenAI rephrases insight + priorities           ← prose only
  validate every number in the output must exist in the facts, or the
           deterministic baseline is used instead
  deliver  one page + one email, same brief object
```

The LLM never originates a number. If a cause isn't in the data, the brief says
"cause unknown from connected data". Trust is the product.

## Setup (~15 minutes)

Create the env file first — every step below writes into it:

```bash
cp .env.example .env.local
openssl rand -base64 32   # → ENCRYPTION_KEY in .env.local
```

`.env.example` is tracked by git, so it only ever holds blank placeholders.
Real values go in `.env.local`, which `.gitignore` covers via `.env*.local`.

### 1. Supabase project (the app's own)

1. Create a project at [supabase.com](https://supabase.com).
   - **Enable Data API**: ON (required for `supabase-js`).
   - **Automatically expose new tables**: OFF (new tables stay private
     until you deliberately grant access).
   - **Enable automatic RLS**: ON (new tables get RLS on from creation).
2. Run the files in `supabase/migrations/` in the SQL editor, in filename
   order. `0002` installs a trigger on `auth.users`, so run it from the SQL
   editor (which has the privileges) rather than from a client.
3. Auth → Providers → enable **Email**.
4. Auth → Email Templates — **required, sign-in is broken without it.**

   Sign-in is a 6-digit code, not a link. Supabase decides which to send by
   what the template contains: `{{ .ConfirmationURL }}` sends a link,
   `{{ .Token }}` sends a code. Edit **both** the *Magic Link* and *Confirm
   sign up* templates to use the code — the first is used for returning users,
   the second for someone signing in for the very first time, and missing
   either one breaks that half of your users:

   ```html
   <h2>Your sign-in code</h2>
   <p>Enter this code to sign in. It expires shortly.</p>
   <p style="font-size:24px;letter-spacing:4px"><strong>{{ .Token }}</strong></p>
   ```

   Codes are what dodge the prefetch problem: corporate mail scanners
   (Outlook Safe Links and similar) follow links in incoming mail, which
   consumes a one-time `ConfirmationURL` before the user ever clicks it and
   greets them with "Token has expired or is invalid". A code can't be
   consumed by being read. Note this is why the two cannot be offered side by
   side — a link and a code in the same email share one token, so a scanner
   burning the link kills the code too.
5. Auth → Providers → Email → **Email OTP Expiration** — the default is fine;
   Supabase caps it at 24h to limit brute-force time.
6. Auth → URL Configuration:
   - **Site URL** — a single value, set it to **production**
     (`https://YOURAPP`).
   - **Redirect URLs** — an allowlist; add `https://YOURAPP/auth/callback` and
     `http://localhost:3000/auth/callback`. The code flow doesn't redirect, but
     `app/auth/callback/route.ts` is kept as a fallback for the case where a
     template still holds `{{ .ConfirmationURL }}`, and it needs these to work.
7. Settings → API → copy the project URL, `anon` key, and `service_role` key
   into `.env.local`.

### 2. GitHub OAuth App (one, plus one for local dev)

GitHub is a **data source, not a sign-in method** — the only way into the app
is an emailed sign-in code. So there is one OAuth App, used during onboarding
to read repos. A GitHub OAuth App has only **one** Authorization callback URL
and this one points at your own server, which is why dev and prod need
separate apps.

**First: create a GitHub Organization to own it.**

An OAuth App registered under a personal account shows *your personal handle
and avatar* as the publisher on the consent screen every user sees when they
connect GitHub. An org shows the product's name instead, and can later apply
for publisher verification (which removes the "unverified app" notice).

This is not a second GitHub account — from your existing one, go to Settings →
Organizations → **New organization** (free plan). You become its owner; your
personal repos stay personal.

1. **Organization name** — this is public and is what users see when they
   connect GitHub. Use the product name, e.g. `founderbrief`.
2. **Contact email** (required) — used by GitHub for billing and account
   notices. It is not published on the org profile; the profile's public email
   is a separate, optional field.
3. **This organization belongs to** — choose **My personal account** unless you
   have actually registered a company. This sets who legally controls the org,
   not what is displayed; the consent screen still shows the org name, never
   your personal handle.
4. After creating it, go to `github.com/orgs/<yourorg>/people` and confirm your
   membership reads **Private**. This keeps your personal account off the org's
   public members list — the last place it would otherwise be linked.

Then register the app below **under the org** (the New OAuth App form has an
Owner dropdown — pick the org, not yourself).

> Already made it under your personal account? App settings → Transfer
> ownership. The Client ID and Secret survive the move, so nothing breaks and
> connected users don't need to re-authorize.

**The app** (credentials go to `.env.local`)

1. GitHub → Settings → Developer settings → OAuth Apps → **New OAuth App**
   - Application name: `Founder Brief — GitHub data`
   - Homepage URL: `https://YOURAPP`
   - Authorization callback URL:
     `https://YOURAPP/api/integrations/github/callback`
   - Register application
2. Copy the Client ID and generate a secret.
3. Put them in `.env.local` as `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET`.

Since one OAuth App allows only one callback URL, register a **second** app for
local development — identical, but with callback
`http://localhost:3000/api/integrations/github/callback` — and use its
credentials in your local `.env.local`, keeping the production pair for Vercel.

`NEXT_PUBLIC_APP_URL` must match the registered callback's host **exactly** —
apex vs `www` counts as a mismatch, and GitHub rejects the handshake with a
redirect URI error. If it is unset the code falls back to the request origin,
which on Vercel can be the `*.vercel.app` deployment host rather than your
domain. For the same reason, preview deployments cannot complete this flow.

These live in `.env.local` rather than Supabase because your Next.js server
runs this handshake itself (`app/api/integrations/github/authorize/route.ts`),
requesting the `repo read:user` scope.

Replace `YOURAPP` throughout with your real production domain once you know it
(Vercel gives you one at first deploy); the callback URLs can be edited on an
existing OAuth App at any time without invalidating its Client ID or Secret.

### 3. Email delivery

Two separate email paths, configured in two different places:

1. **Brief emails** — sent by the app through Resend (`lib/email/send.ts`).
   Verify a domain at [resend.com](https://resend.com), put the API key in
   `RESEND_API_KEY`, and set `EMAIL_FROM` to an address on that domain.
2. **Sign-in emails** — sent by Supabase, *not* by the code above. Supabase's
   built-in email service is documented as testing-only and rate-limited to a
   handful of messages per hour, which breaks signups almost immediately on a
   public app. Set **custom SMTP** in Supabase → Project Settings → Auth →
   SMTP Settings, pointing at the same Resend account.

`OPENAI_API_KEY` and `RESEND_API_KEY` are optional in development: without
OpenAI, briefs are fully deterministic (still correct); without Resend, no
email is sent.

### 4. Run

```bash
npm install
npm run dev
```

### 5. Deploy (Vercel)

1. Push to GitHub, import into Vercel.
2. Add all env vars (set `NEXT_PUBLIC_APP_URL` to the production URL and
   `CRON_SECRET` to a random string — `openssl rand -base64 32`).
3. Once you know the production domain, replace `YOURAPP` in the three places
   that hardcode it: Supabase **Site URL**, Supabase **Redirect URLs**, and the
   GitHub OAuth App's Authorization callback URL. All three must use the same
   host you set in `NEXT_PUBLIC_APP_URL` — pick apex or `www` and redirect the
   other to it.

**Scheduling the brief.** `/api/cron/hourly` must run every hour: each run
serves only the users whose local time has just reached their send hour
(`app/api/cron/hourly/route.ts`), so a less frequent schedule silently skips
every other timezone — no error, just users who never receive anything.

Vercel's **Hobby plan allows only one cron per day**, and a deployment whose
`vercel.json` declares an hourly schedule is rejected at config validation —
it fails *before* a build record is created, so the Deployments list stays
empty rather than showing a failure. Hence the split:

- `vercel.json` — daily at 06:00 UTC, within the Hobby limit. Harmless
  duplicate work; the endpoint is idempotent per (user, day).
- `.github/workflows/hourly-brief.yml` — the real hourly tick, free. Add
  `CRON_SECRET` under repo → Settings → Secrets and variables → **Actions**,
  matching the Vercel value exactly, or the endpoint returns 401. Trigger a
  test run from the Actions tab (`workflow_dispatch`) rather than waiting.

  GitHub disables scheduled workflows after 60 days of repo inactivity (any
  commit re-enables them), and the schedule is best-effort, so runs can land a
  few minutes late.

On Vercel Pro, set `vercel.json` back to `0 * * * *` and delete the workflow.

## Architecture notes

- **`lib/brief/diff.ts`** — the deterministic engine. Ledger rows, streaks,
  gaps, the numeric allowlist. Every visible number comes from here.
- **`lib/brief/generate.ts`** — the pipeline. Collect → facts → baseline →
  LLM polish → validate → store. Idempotent per (user, day).
- **`lib/collectors/`** — pure fetch-and-store, zero AI.
- Integration tokens are AES-256-GCM encrypted at rest (`lib/crypto.ts`).
- RLS on every table; service-role writes are explicitly user-scoped.
- The founder's Supabase is queried with **counts only** (PostgREST `HEAD` +
  `count=exact`) — row contents are never read and never sent to OpenAI.

## Roadmap

See [POST_MVP.md](./POST_MVP.md) — every deferred feature, staged by trigger
(not date), plus the scaling path.

## Security

- Never expose `SUPABASE_SERVICE_ROLE_KEY`, `ENCRYPTION_KEY`, or integration
  tokens to the client.
- Recommend founders create a **read-only** Postgres role / restricted key for
  the data-source connection rather than their service key.
- Only aggregate counts and PR titles reach OpenAI — no end-user PII.
