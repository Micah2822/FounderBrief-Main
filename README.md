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

### 1. Supabase project (the app's own)

1. Create a project at [supabase.com](https://supabase.com).
   - **Enable Data API**: ON (required for `supabase-js`).
   - **Automatically expose new tables**: OFF (new tables stay private
     until you deliberately grant access).
   - **Enable automatic RLS**: ON (new tables get RLS on from creation).
2. Run `supabase/migrations/0001_init.sql` in the SQL editor.
3. Auth → Providers → enable **Email**. No config needed; this powers the
   magic-link sign-in.
4. Auth → URL Configuration → Site URL = `http://localhost:3000`, and add
   `http://localhost:3000/auth/callback` to Redirect URLs.
5. Settings → API → copy the project URL, `anon` key, and `service_role` key
   into `.env.local`.

### 2. GitHub OAuth Apps (you need two)

Two, because a GitHub OAuth App has only **one** Authorization callback URL,
and these two flows land on different hosts — sign-in goes to Supabase, the
data integration goes to your own server.

**First: create a GitHub Organization to own them.**

An OAuth App registered under a personal account shows *your personal handle
and avatar* as the publisher on the consent screen every user sees at sign-up.
An org shows the product's name instead, and can later apply for publisher
verification (which removes the "unverified app" notice).

This is not a second GitHub account — from your existing one, go to Settings →
Organizations → **New organization** (free plan). You become its owner; your
personal repos stay personal.

1. **Organization name** — this is public and is what users see when they
   authorize. Use the product name, e.g. `founderbrief`.
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

Then register both apps below **under the org** (the New OAuth App form has an
Owner dropdown — pick the org, not yourself).

> Already made them under your personal account? App settings → Transfer
> ownership. The Client ID and Secret survive the move, so nothing breaks and
> connected users don't need to re-authorize.

**App A — sign-in** (credentials go to *Supabase*)

1. In Supabase: Auth → Providers → **GitHub**. Copy the **Callback URL (for
   OAuth)** shown there — `https://<project-ref>.supabase.co/auth/v1/callback`.
   Keep the tab open.
2. GitHub → Settings → Developer settings → OAuth Apps → **New OAuth App**
   - Application name: `Founder Brief — Sign in`
   - Homepage URL: `http://localhost:3000`
   - Authorization callback URL: **paste the Supabase URL from step 1**
   - Register application
3. Copy the **Client ID**, then **Generate a new client secret** and copy it.
4. Back in the Supabase GitHub tab: paste both, leave **Allow users without an
   email** OFF (briefs are delivered by email), toggle **GitHub enabled** ON,
   and Save.

**App B — data integration** (credentials go to `.env.local`)

1. GitHub → Developer settings → OAuth Apps → **New OAuth App** (a second,
   separate app)
   - Application name: `Founder Brief — GitHub data`
   - Homepage URL: `http://localhost:3000`
   - Authorization callback URL:
     `http://localhost:3000/api/integrations/github/callback`
   - Register application
2. Copy the Client ID and generate a secret.
3. Put them in `.env.local` as `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET`.

These live in `.env.local` rather than Supabase because your Next.js server
runs this handshake itself (`app/api/integrations/github/authorize/route.ts`),
requesting the `repo read:user` scope.

> When you deploy, App B's callback URL must be changed to your production URL
> (or register a separate app for prod) — one app, one callback.

### 3. Environment

```bash
cp .env.example .env.local
openssl rand -base64 32   # → ENCRYPTION_KEY
```

`OPENAI_API_KEY` and `RESEND_API_KEY` are optional: without OpenAI, briefs are
fully deterministic (still correct); without Resend, no email is sent.

### 4. Run

```bash
npm install
npm run dev
```

### 5. Deploy (Vercel)

1. Push to GitHub, import into Vercel.
2. Add all env vars (set `NEXT_PUBLIC_APP_URL` to the production URL and
   `CRON_SECRET` to a random string — Vercel sends it automatically to the cron).
3. `vercel.json` schedules `/api/cron/hourly` — each user gets their brief
   generated and emailed at their own local send hour (default 07:00).
4. Verify a domain in [Resend](https://resend.com) and set `EMAIL_FROM`.

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
