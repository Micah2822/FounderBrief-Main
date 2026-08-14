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

## Setup (~25 minutes)

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
   order. Run them from the SQL editor rather than from a client: `0002`
   installs a trigger on `auth.users` and `0003` issues `GRANT`s, both of
   which need privileges a client key does not have.

   `0003` is not optional. Because **Automatically expose new tables** is OFF
   (step 1), tables are created with no privileges granted to any role —
   enabling RLS and writing policies is *not* sufficient, since RLS filters
   rows for a role that already holds the table privilege. Without the grants
   every server write fails with `42501 permission denied`, and because the
   app treats a failed write as a no-op the only symptom is a UI that never
   changes state.
3. Auth → Providers → enable **Email**.
4. Auth → Email Templates — **required, sign-in is broken without it.**

   Sign-in is an emailed code, not a link. Supabase decides which to send by
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

### 2. GitHub App

GitHub is a **data source, not a sign-in method** — the only way into the app
is an emailed sign-in code. This is a GitHub **App**, not an OAuth App, and the
distinction matters: OAuth Apps have no read-only scope for private
repositories. Their only options are `public_repo` (write access, public repos
only) and `repo` (read *and write* on everything), so the consent screen would
read "Full control of private repositories" for a product that just counts
commits. Fine-grained read-only permissions exist only on GitHub Apps.

Two consequences worth knowing before you start:

- **No GitHub credential is ever stored.** The row in `integrations` holds an
  `installation_id`, which is not a secret; tokens are minted on demand from the
  app's private key (`lib/github/app-auth.ts`).
- **One app covers dev and production.** GitHub Apps accept several callback
  URLs, so unlike an OAuth App there is no need for a separate localhost app.

**First: create a GitHub Organization to own it.**

An app registered under a personal account shows *your personal handle and
avatar* as the publisher on the consent screen every user sees when they connect
GitHub. An org shows the product's name instead, and can later apply for
publisher verification (which removes the "unverified app" notice).

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

Then register the app below **under the org** (the New GitHub App form has an
Owner dropdown — pick the org, not yourself).

> Already made it under your personal account? App settings → Transfer
> ownership. The App ID and private key survive the move, so nothing breaks and
> existing installations stay intact.

**The app** (credentials go to `.env.local`)

1. GitHub → Settings → Developer settings → **GitHub Apps** → **New GitHub App**
   - GitHub App name: `Founder Brief` (this is what users see)
   - Homepage URL: `https://YOURAPP`
   - Callback URL: `https://YOURAPP/api/integrations/github/callback`
     — then **Add callback URL** and also add
     `http://localhost:3000/api/integrations/github/callback`
   - **Post installation → Setup URL:**
     `https://YOURAPP/api/integrations/github/callback`
   - **Post installation → check "Redirect on update"**
   - **Uncheck** "Expire user authorization tokens" — unused, we never issue
     user tokens.
   - Webhook → **uncheck Active**. Nothing here listens for webhooks.

   > **The Setup URL is the one that actually matters, and it is easy to skip.**
   > For a GitHub App the Callback URL governs the *user-authorization* flow,
   > which this app doesn't use. The redirect after an **installation** is the
   > Setup URL. Leave it blank and installs simply end on github.com: our
   > handler never runs, no row is written, and onboarding still shows "Connect
   > GitHub" while GitHub shows "Configure" — with nothing in your logs, because
   > no request ever reached your server. "Redirect on update" is what brings a
   > user back after they change which repos the app can see.
   >
   > Setup URL takes a single value, so in development either point it at
   > `http://localhost:3000/...` temporarily or test against production.
2. **Repository permissions** — read-only, and nothing else:

   | Permission | Access |
   |---|---|
   | Contents | Read-only |
   | Pull requests | Read-only |
   | Issues | Read-only |
   | Deployments | Read-only |
   | Metadata | Read-only (mandatory) |

   Grant no write access anywhere and no account permissions. If you find
   yourself adding a write permission to fix something, the fix is wrong.
3. **Where can this GitHub App be installed?** → **Any account**. Without this,
   only your own org can connect and no customer can onboard.
4. Create the app, then **Generate a private key**. A `.pem` downloads — this is
   the only copy, GitHub does not show it again.
5. Fill `.env.local`:
   - `GITHUB_APP_ID` — the App ID on the app's settings page
   - `GITHUB_APP_SLUG` — the last path segment of the app's public page
     (`github.com/apps/<slug>`), which is the name lowercased and hyphenated
   - `GITHUB_APP_PRIVATE_KEY` — the `.pem` contents, **on one line, quoted**:

     ```bash
     awk '{printf "%s\\n", $0}' ~/Downloads/*.private-key.pem | pbcopy
     ```

     ```
     GITHUB_APP_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\nMIIEow...\n-----END RSA PRIVATE KEY-----\n"
     ```

     Real newlines work too, but **only if the whole block is wrapped in double
     quotes** — dotenv keeps a multi-line value only when quoted. Unquoted, it
     silently keeps just the `-----BEGIN` line, which still looks like a PEM
     until signing fails. Use the single-line form: it behaves identically in
     `.env.local` and in Vercel's env field.

6. Check it before going further — this validates the ID and key *together* and
   prints nothing secret:

   ```bash
   node scripts/check-github-app.mjs
   ```

   A 401 from `GET /app` means the App ID and the private key don't belong to
   each other. The most common cause is pasting the **Client ID** (`Iv1.…`) into
   `GITHUB_APP_ID` — it wants the plain number shown above it.
     To read run; `cat <name>.private-key.pem`

`NEXT_PUBLIC_APP_URL` must match a registered callback's host **exactly** — apex
vs `www` counts as a mismatch, and GitHub rejects the handshake with a redirect
URI error. If it is unset the code falls back to the request origin, which on
Vercel can be the `*.vercel.app` deployment host rather than your domain. For
the same reason, preview deployments cannot complete this flow.

Replace `YOURAPP` throughout with your real production domain once you know it
(Vercel gives you one at first deploy); callback URLs can be edited on an
existing app at any time without invalidating the App ID or private key.

### 3. Supabase OAuth app (for connecting *users'* projects)

Not to be confused with section 1. That was **your** Supabase project, where
Founder Brief stores its own data. This is an OAuth app registered against the
Supabase **Management API** so that a user connecting their product's database
picks a project from a dropdown instead of hunting down a `service_role` key.

How it works, and why it is safe: the management token can read API keys for
every project in the user's organisation, which is far more authority than the
brief needs. So it is never stored. It lives in an encrypted, httpOnly,
10-minute cookie, is used once to fetch the chosen project's key, and is then
discarded (`lib/supabase-oauth.ts`). What ends up in the database is a single
project's key — see Security below for why that is still the largest asset
this app holds.

1. Supabase dashboard → **Organization Settings** → **OAuth Apps** →
   **Add application**.
   - Application name: `Founder Brief`
   - Website: `https://YOURAPP`
   - Authorization callback URLs — **Add URL** twice, as with the GitHub App:
     `https://YOURAPP/api/integrations/supabase/callback` and
     `http://localhost:3000/api/integrations/supabase/callback`

   Both must end in `/supabase/callback`. Pasting the `/github/callback` URL
   here is an easy slip and fails at the redirect with nothing in your own logs,
   because the request never reaches your server.
2. **Permissions** — the app makes exactly two calls, so it needs exactly two
   read scopes:

   | Category | Access | Why |
   |---|---|---|
   | Projects | Read | `GET /v1/projects` — builds the project dropdown |
   | Secrets | Read | `GET /v1/projects/{ref}/api-keys` — fetches the chosen project's key |
   | *everything else* | **None** | Auth, Database, Domains, Edge Functions, Environment, Rest, Storage, Analytics, Organizations |

   **No Write access on any category.** Nothing in this codebase writes to a
   user's Supabase; if you find yourself granting one to fix an error, the fix
   is wrong.

   If the project dropdown loads but choosing one fails with a 403, the API-key
   read sits under a different scope than **Secrets** in your dashboard's
   wording — grant the next-narrowest read scope, not a blanket one, and
   correct this table. Supabase has renamed these buckets before.

   Worth being clear-eyed about what **Secrets: Read** is: it can read API keys
   for *every* project in the organisation, not just the one the user picks.
   That is precisely why the token is discarded after a single use rather than
   stored (`lib/supabase-oauth.ts`). The scope is broad because Supabase offers
   nothing narrower — the mitigation is how briefly we hold it.
3. Copy the client ID and secret into `.env.local` as
   `SUPABASE_OAUTH_CLIENT_ID` / `SUPABASE_OAUTH_CLIENT_SECRET`.

If these are unset the connect button returns a configuration error and Supabase
cannot be connected at all. **There is no pasted-key fallback.** It was removed
deliberately: it was the only place a founder was asked to hand a `service_role`
key to a web form, and its only real audience was self-hosted Supabase, which
has no Management API. Self-hosted founders land in the "using a different
tool?" capture on the onboarding page instead.

### 4. Email delivery

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

### 5. Stripe billing

Free accounts connect two tools; Founder ($19/month) connects all of them. This
section sets up the Stripe side. It is unrelated to the Stripe *connector* users
set up during onboarding, which reads a **user's** revenue from a restricted key
they paste and needs no configuration from you. This is **your** Stripe account,
the one that charges them.

**A separate Stripe account, not a separate login.** Stripe uses "account" for
two things: your login, and the businesses under it that you switch between
top-left. Founder Brief needs its own business account, because payouts,
customers, products, tax reporting and webhooks are all per-account — and
because sharing one means another project's customer list is one API call from
this app's key. Account switcher → **New account**.

> **Check the account switcher before every step below.** With several accounts
> on one login it is easy to create the product, the key or the webhook in the
> wrong one, and **nothing in a credential says which account it came from** —
> an `rk_test_…` from another project looks identical. The symptom is "No such
> price" at checkout, or a live charge landing in the wrong business.

**Sandbox first.** Stripe calls its isolated non-live environment either *test
mode* (a toggle) or a *sandbox* (a picker), depending on the account — same
thing, and this guide works in either. What is stable is the key prefix:
`rk_test_…` is safe, `rk_live_…` moves real money. Products, prices, webhooks
and portal configuration **do not cross between sandbox and live**, so every
step here is done twice — once now, once at section 7 before launch — and the
price id is different each time. That is expected, not a mistake.

**5.1 Product and price.** Product catalogue → **+ Add product**:

| Field | Value |
|---|---|
| Name | `Founder Brief — Founder` (shown at checkout and on the invoice) |
| Description | one line, optional |
| Tax category | **Software as a service — business use**. Not any "mobile" entry: there is no app-store build, this is a hosted web subscription |
| Pricing model | Standard pricing |
| Amount | `19.00`, `USD` |
| Billing period | **Recurring**, Monthly |
| Include tax in price | **No** — see below |
| Free trial | none |

Then copy the **price id** — `price_…`, from the pricing row, *not* the `prod_…`
above it — into `STRIPE_PRICE_FOUNDER`.

*Tax category* does nothing until Stripe Tax is enabled, which this app does not
do. Set it correctly anyway; it is what Stripe Tax would use later.

*Tax exclusive* (not included in the price) because inclusive makes $19 the
total and carves the tax out of it — a 20% VAT sale would net $15.83 instead of
$19, on every EU customer. Exclusive is also the norm for B2B, where an EU
business with a VAT id pays no VAT at all under reverse charge. Note that Stripe
lets a price move from unspecified to inclusive or exclusive **once** and then
locks it; changing your mind later means a new price and migrating subscribers.

**5.2 Restricted key.** Developers → API keys → **+ Create restricted key**.

- *How will you be using this key?* → **Powering an integration you built**. The
  key goes in this app's server code. Not "third-party application" (that is for
  handing a key to software someone else wrote) and not "authorising an AI
  agent" (that is standing MCP/CLI access).
- *Permission template* → **Choose your own**. The "Recurring subscriptions and
  billing" template grants around 40 permissions where this app uses four,
  including invoice and usage writes it never calls — taking it would undo the
  reason for using a restricted key at all.
- Grant **Write** on exactly these, **None** on everything else:
  **Customers**, **Checkout Sessions**, **Customer portal**, **Subscriptions**.

Name it `founder-brief-billing` and copy the `rk_test_…` into
`STRIPE_BILLING_SECRET_KEY`.

Founder Brief never creates a charge or issues a refund, so a full secret key
(`sk_`) would store authority the product never exercises. This keeps the
property that **no `sk_` exists anywhere in the product** — the connector
enforces the same rule on users' keys at its API boundary.

> Restricted key permissions are **editable after creation**, so none of this is
> one-way. If a call fails later, Stripe's error names the exact resource it
> wanted; add that one rather than widening to a template.

**5.3 Activate the Customer portal.** Settings → Billing → **Customer portal** →
activate, with *Cancel subscriptions* and *Update payment methods* enabled.
This is where cancellation, card updates and invoices live, which is why the app
has no billing UI of its own.

> Easy to skip, and it does not fail where you'd look for it: without an
> activated portal, `billingPortal.sessions.create` throws a configuration error
> at runtime that reads exactly like an application bug. It must be activated
> separately in sandbox and in live.

**5.4 Statement descriptor.** Settings → Business → Public details. This is what
appears on your customers' card statements; if it is unset or unrecognisable you
get chargebacks from people who don't recognise the charge.

**5.5 Webhook.** Stripe tells the app about payments by POSTing to
`/api/billing/webhook`. Nothing activates a subscription without it: checkout
completing in the browser is not what grants access — the webhook is.

That endpoint is public (Stripe sends no session cookie), so **the signature is
the only thing standing between a stranger and a free `founder` tier**. It is
verified against `STRIPE_BILLING_WEBHOOK_SECRET` on every request, and the
secret is different in development and production.

*In development*, install the [Stripe CLI](https://stripe.com/docs/stripe-cli),
then:

```bash
stripe login
stripe listen --forward-to localhost:3000/api/billing/webhook
```

It prints a `whsec_…` on start. **That is the value for `.env.local`** — it is
not the same as the one the dashboard shows for a hosted endpoint, and using the
dashboard's value locally fails every signature check. Leave `stripe listen`
running while you test; it re-prints the same secret each time.

*In production*, Developers → **Webhooks** → **Add endpoint**:

- URL: `https://YOURAPP/api/billing/webhook`
- Events: `checkout.session.completed`, `customer.subscription.created`,
  `customer.subscription.updated`, `customer.subscription.deleted`

Copy that endpoint's signing secret into Vercel as
`STRIPE_BILLING_WEBHOOK_SECRET`. Like everything else in this section, the
endpoint is per-environment — a sandbox endpoint never fires for live payments.

**5.6 Environment variables.** Three, all from the steps above:

| Var | Where it comes from | Dev | Production |
|---|---|---|---|
| `STRIPE_BILLING_SECRET_KEY` | 5.2 | `rk_test_…` | `rk_live_…` |
| `STRIPE_PRICE_FOUNDER` | 5.1 | sandbox `price_…` | live `price_…` |
| `STRIPE_BILLING_WEBHOOK_SECRET` | 5.5 | from `stripe listen` | from the hosted endpoint |

Sandbox values go in `.env.local` and stay there. Live values go in Vercel's
Production environment and nowhere else. **Every one of the six differs between
the two columns** — the commonest way to break this is to carry one across.

**5.7 Migration.** Apply `supabase/migrations/0004_billing.sql`, which adds
`tier` and `stripe_customer_id` to `user_settings`. Migrations are applied by
hand (see ARCHITECTURE › Data model). Everyone existing defaults to `free`.

**Existing deployment.** If you are adding billing to a database that already
has users, nothing else changes: they default to `free`, nobody is revoked, and
anyone already holding three or four connectors keeps them — the limit blocks
*new* connections only. Expect to see those accounts and do not treat them as a
bug.

### 6. Run

```bash
npm install
npm run dev
```

### 7. Deploy (Vercel)

1. Push to GitHub, import into Vercel.
2. Add all env vars (set `NEXT_PUBLIC_APP_URL` to the production URL and
   `CRON_SECRET` to a random string — `openssl rand -base64 32`).

   **Set `ALERT_EMAIL` to your own address.** Without it you are not told when a
   brief fails: the failure is caught, logged, and invisible. The same variable
   is the on/off switch and the recipient — unset it to stop the alerts, change
   it to redirect them, and redeploy either way. The alert contains a step name,
   a count and account ids only, never the error itself (see ARCHITECTURE ›
   Knowing when a brief fails for why).

   Separately, and needing no configuration: if a run fails outright the route
   returns `500`, the GitHub Action goes red, and GitHub emails you about the
   failed workflow. Silence or redirect *that* one under GitHub → Settings →
   Notifications → Actions.
3. **Redo section 5 in live mode.** Sandbox and live share nothing: create the
   product and price again, create a new restricted key with the same four
   permissions, **activate the Customer portal again**, and **add the webhook
   endpoint** pointing at the production URL (section 5.5). That yields three
   new values — `rk_live_…`, a live `price_…`, and the endpoint's own
   `whsec_…` — which go in Vercel's Production environment only, with the
   sandbox values left in `.env.local`. Stripe also needs business and bank
   details before it will accept live payments, and that can require
   verification — start it well before you plan to launch.

   The webhook is the step whose absence is silent: checkout succeeds, the
   customer is charged, and their tier never changes.
4. Once you know the production domain, replace `YOURAPP` everywhere it is
   hardcoded outside the repo:
   - Supabase **Site URL** (section 1)
   - Supabase **Redirect URLs** (section 1)
   - the **GitHub App's callback URL** (section 2)
   - the **Supabase OAuth app's redirect URL** (section 3)

   All four must use the same host you set in `NEXT_PUBLIC_APP_URL` — pick apex
   or `www` and redirect the other to it. A mismatch fails at the redirect,
   which looks like a connector that silently refuses to connect.

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
- **`lib/github/app-auth.ts`** — mints installation tokens from the GitHub App's
  private key. No GitHub credential is stored, so there is nothing to leak.
- **`lib/supabase-oauth.ts`** — the Management API handshake, and the reason the
  token it obtains is deliberately thrown away.
- Stored keys are AES-256-GCM encrypted at rest (`lib/crypto.ts`).
- RLS on every table; service-role writes are explicitly user-scoped.
- The founder's Supabase is queried with **counts only** (PostgREST `HEAD` +
  `count=exact`) — row contents are never read and never sent to OpenAI.

## Roadmap

See [POST_MVP.md](./POST_MVP.md) — every deferred feature, staged by trigger
(not date), plus the scaling path.

## Security

The guiding rule is to ask each tool for the least it will grant, and to hold as
little of that as possible.

- **GitHub** — read-only permissions, per-repository, and **no credential
  stored**: the row holds an `installation_id` and tokens are minted per run.
  Never migrate back to an OAuth App; `repo` is the only scope that can read
  private repositories and it carries write access with it.
- **Supabase** — the OAuth flow's management token is used once and discarded,
  so we hold one project's key rather than standing access to an organisation.
  Keeping that token "to make refreshes easier" would undo the whole point.
- **Stripe** — restricted keys only (`rk_`). Secret keys are rejected at the
  API boundary; `scripts/audit-stripe-keys.mjs` reports any stored before that
  was enforced.
- **Plausible** — no OAuth exists; its keys are read-only by nature.
- **There is no manual Supabase path.** OAuth is the only way to connect, so no
  founder is ever asked to paste a key into a form. Do not reintroduce one as a
  convenience.
- Never expose `SUPABASE_SERVICE_ROLE_KEY`, `ENCRYPTION_KEY`, or integration
  tokens to the client.
- **Rotating `ENCRYPTION_KEY`:** do not just change it in Vercel. Every stored
  credential is encrypted with it and becomes permanently unreadable — the only
  recovery is asking every customer to reconnect. Follow the numbered runbook in
  the header of `scripts/rotate-encryption-key.mjs`; done in that order it is
  zero-downtime, because `lib/crypto.ts` accepts `ENCRYPTION_KEY_OLD` alongside
  the new key for the duration.
- Only aggregate counts and PR titles reach OpenAI — no end-user PII.
