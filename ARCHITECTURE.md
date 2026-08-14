# Founder Brief — Architecture

Orientation for developers and AI agents working in this repo. Read this before
changing the brief pipeline, the data model, or anything that renders a brief.

**Companion docs:** [README.md](README.md) (setup/runbook),
[POST_MVP.md](POST_MVP.md) (roadmap and deliberately-deferred work with the
reasoning intact), [BRANDING.md](BRANDING.md) (voice and visual language).

This file names files and functions rather than line numbers, so it survives
ordinary edits. See [Keeping this current](#keeping-this-current) at the end.

---

## What this is

A daily brief for early-stage founders. Overnight it reads the tools they've
connected — GitHub, their product's Supabase, Plausible, Stripe — compares
today against yesterday and this week against last, and produces one page and
one email answering *what happened yesterday, and what should I focus on today?*

It is a **public, multi-tenant SaaS** with third-party signups, not a
self-hosted personal tool. Assume adversarial users when touching anything that
accepts input or reaches an LLM.

---

## Invariants

These are the product, not preferences. Breaking one is a bug even if tests pass.

1. **Every number is computed, never generated.** The deterministic engine in
   `lib/brief/diff.ts` originates all figures. Enforced at runtime by
   `numbersAreGrounded()` against the `allowedNumbers()` allowlist — if the model
   emits a digit sequence that isn't in the facts, the whole response is
   discarded and the deterministic baseline ships instead.
   **Numbers are the only part enforced.** When `polishWithLLM` succeeds, its
   `priorities` array replaces the baseline wholesale and nothing compares the
   two — the model may reorder, drop, or introduce a recommendation the scorer
   never proposed. That latitude is intentional, but it is steered by the prompt,
   not guaranteed by code. Don't treat it as a constraint you can build on.
2. **The deterministic path must always be able to ship alone.** `OPENAI_API_KEY`
   may be absent, and `polishWithLLM` gives up after two attempts. Whatever
   `baselineInsight()` and `baselinePriorities()` produce is what a founder
   reads on a bad day. Never move logic into the prompt that the baseline needs.
3. **No invented causes.** If the data can't explain a change, the brief says
   "cause unknown from connected data". Never a plausible story.
4. **The founder's database is counted, not read — with exactly one exception.**
   `lib/collectors/supabase.ts` issues `HEAD` requests with
   `Prefer: count=exact`, and `lastRowAt()` selects **one column, one row**: the
   most recent value of the single date column the founder mapped, used to
   compute a day count and then discarded. Nothing else is ever selected, and
   no other column is readable. This exception is narrow, deliberate, and
   **mirrored in the user-facing promises** on the landing page and the privacy
   policy — if you widen it, those two pages must change in the same commit, or
   the product is lying to its users. Do not add a collector that selects rows.
5. **Idempotent by `(user_id, date)`.** Every write is an upsert on that key.
   This is what makes retries and re-runs safe; keep it.
6. **Honest gaps.** A missing integration or a failed collection is stated in
   the brief's `gaps` array, not hidden.
7. **One page, no dashboard.** No charts, no filters, no tabs.
8. **Ask each tool for the least it will grant, and keep less than that.** Every
   connector is read-only. GitHub stores no credential at all; the Supabase
   management token is discarded after one use; Stripe takes restricted keys
   only. Widening a grant for convenience is a bug — see
   [Auth and security](#auth-and-security) for the two invariants easiest to
   undo by accident.

---

## Stack

Next.js 14 App Router · React 18 · TypeScript · Tailwind · Supabase
(Postgres + Auth) · OpenAI · Resend · deployed on Vercel.

No test framework, no ESLint config, no state library. The automated checks are
`npx tsc --noEmit` and `npm run check:scoping` (see Auth and security).

### Environment variables

| Var | Used by |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` | browser + server auth clients |
| `SUPABASE_SERVICE_ROLE_KEY` | `createAdminClient()` — every DB read/write |
| `ENCRYPTION_KEY` | AES-256-GCM for integration tokens; **32-byte base64** |
| `OPENAI_API_KEY` / `OPENAI_MODEL` | brief polish + chat (default `gpt-4o-mini`) |
| `RESEND_API_KEY` / `EMAIL_FROM` | the 7am email |
| `NEXT_PUBLIC_APP_URL` | OAuth redirect URI, email links |
| `GITHUB_APP_ID` / `GITHUB_APP_SLUG` | GitHub App identity; slug builds the install URL |
| `GITHUB_APP_PRIVATE_KEY` | signs the RS256 JWT that mints installation tokens; PEM — quote it or escape the newlines, see footguns |
| `SUPABASE_OAUTH_CLIENT_ID` / `_SECRET` | Management API OAuth — the **founder's** Supabase, not the app's |
| `CRON_SECRET` | cron bearer token; **fails closed if unset** |
| `ALERT_EMAIL` | operator failure alerts; **unset = off**, and it is also the recipient |
| `ENCRYPTION_KEY_OLD` | set **only during a key rotation**; see the runbook in `scripts/rotate-encryption-key.mjs` |
| `STRIPE_BILLING_SECRET_KEY` | billing — **your** Stripe account. Restricted (`rk_`), four permissions; never `sk_` |
| `STRIPE_BILLING_WEBHOOK_SECRET` | signature verification for `/api/billing/webhook`; locally this comes from `stripe listen`, not the dashboard |
| `STRIPE_PRICE_FOUNDER` | the `price_…` for $19/month; different in sandbox and live |

---

## Directory map

```
app/
  page.tsx                    Home: brief + archive nav, or <Landing/> when logged out
  login/                      Email OTP sign-in (client-side verify, not a redirect flow)
  onboarding/                 Server shell → <OnboardingFlow/>
  settings/  preview/  privacy/  terms/
  icon.svg  icon1.png  apple-icon.png   Favicon set (Next metadata-file convention)
  api/
    cron/hourly/              Scheduled generate + email. Bearer-auth, timingSafeEqual
    brief/generate/           Manual generation. 30s/user throttle, completes onboarding
    chat/                     Streaming Q&A over stored facts (the only reader of history)
    settings/                 Zod-validated user_settings upsert
    tool-request/             Demand capture for unsupported tools
    integrations/             github/{authorize,callback,repos},
                              supabase/{route,authorize,callback}, plausible, stripe
  auth/callback/              Legacy OAuth-code safety net; not the primary sign-in
lib/
  brief/generate.ts           The pipeline. Orchestrates everything below
  brief/diff.ts               Deterministic engine: ledger, insight, priorities, allowlist
  collectors/*.ts             One file per data source. Fetch and shape only
  github/app-auth.ts          GitHub App JWT → installation token. Stores nothing
  supabase-oauth.ts           Management API OAuth for the FOUNDER's Supabase
  email/send.ts               Brief object → inline-styled HTML email
  supabase/{admin,server,client}.ts   The APP's own Supabase, not a user's
  billing.ts                  Tier + the connector limit. Server-only
  stripe.ts                   Billing Stripe client — OUR account, not a user's
  crypto.ts  dates.ts  types.ts  sample.ts
components/
  BriefView.tsx               The brief, on the web
  Wordmark.tsx                Masthead mark + name; the link home on every page
  Landing.tsx  OnboardingFlow.tsx  SettingsForm.tsx  Chat.tsx
public/robots.txt             Crawlers get the homepage only (see Search visibility)
scripts/generate-icons.mjs    Regenerates the favicon PNGs from app/icon.svg
scripts/audit-stripe-keys.mjs Reports stored Stripe keys that are sk_ not rk_
scripts/audit-billing.mjs     Stripe vs database: tier mismatches and orphans
scripts/rotate-encryption-key.mjs  Re-encrypts integrations under a new ENCRYPTION_KEY
scripts/check-tenant-scoping.mjs   Fails if a service-role query lacks .eq("user_id")
scripts/check-github-app.mjs  Validates GITHUB_APP_* and mints a test token
supabase/migrations/          Sequential SQL, applied by hand
.github/workflows/            hourly-brief.yml — the real brief schedule (see below)
middleware.ts                 Session refresh + route gating
vercel.json                   Daily cron (Hobby-plan placeholder, not the real tick)
```

---

## Data model

All tables are written by the server via the service-role client. RLS restricts
`select` to the owner as defence in depth, but **`authenticated` and `anon` hold
no table grants at all** (migration `0003`) — the browser uses Supabase for auth
only and never queries a table.

| Table | Holds | Written by | Read by |
|---|---|---|---|
| `user_settings` | timezone, `send_hour`, `email_enabled`, `goal`, `onboarded_at`, `last_generate_at`, `tier`, `stripe_customer_id` | settings API, generate route, cron, billing webhook | cron, pipeline, chat, pages, paywall |
| `integrations` | provider, **encrypted** `access_token`, `config` jsonb | integration routes | pipeline, onboarding, settings |
| `daily_metrics` | one row per (user, date, source) | pipeline | **chat only** — see below |
| `briefs` | the rendered `Brief` object as jsonb, `emailed_at` | pipeline, cron | home page, chat |
| `chat_messages` | conversation history | chat route | chat route |
| `tool_requests` | "I use X" votes for the roadmap | tool-request route | you, manually |

A `user_settings` row is created by an `auth.users` insert trigger (migration
`0002`), **not** by application code — a user without one silently receives
nothing forever, which is why it lives in the database. That function is
`security definer`, so `0002` also revokes `execute` from `public`, `anon` and
`authenticated`: PostgREST would otherwise publish it at
`/rest/v1/rpc/handle_new_user`. A trigger runs as the table owner and never
consults `execute`, so the revoke costs nothing.

Supabase's own `public.rls_auto_enable()` (installed by the automatic-RLS
project setting) raises the same linter warning and has had the same `revoke`
applied by hand — **not** in a migration, since it isn't our object. That one is
a false positive either way: it `RETURNS EVENT_TRIGGER`, a pseudo-type Postgres
refuses to invoke directly, so it was never callable regardless of grants.
Run `get_advisors` after any DDL; two warnings remain and neither is actionable
(the other is leaked-password protection, which does not apply to OTP sign-in).

**Migrations are applied by hand and nothing records which have run** —
`list_migrations` on the project is empty, so the files under
`supabase/migrations/` are effectively the setup script and the only source of
truth. Two consequences: run them in filename order on any new environment, and
never write a migration that creates a problem and then fixes it in a later
file, because there is no mechanism guaranteeing the later one is ever applied.
Adopting the Supabase CLI would remove this caveat.

### Tiers live on `user_settings`, not in a billing table

`tier` is `free` or `founder`; `stripe_customer_id` is the only link to Stripe.
There is no `subscriptions` table, deliberately. Every user already has exactly
one `user_settings` row (the `0002` trigger guarantees it), so there is no
"billing row doesn't exist yet" case anywhere; `0003` already grants
`service_role` what it needs here, where a new table would need its own grant;
and the row already cascades from `auth.users`, so deletion stays complete.

**Subscription status, period end and cancel-at-period-end are deliberately not
stored.** The Stripe Customer Portal shows all three, and a local mirror of
Stripe's state machine drifts from it. The app asks one question — is this user
paying — and `tier` answers it. Settings renders "Active" from `tier` alone,
because `tier` is only `founder` while the subscription is live.

A partial unique index enforces one Stripe customer per user. That is not
defensive tidiness: it prevents one person's payment granting another person's
access, and it is what makes the billing webhook's `stripe_customer_id` lookup a
real tenant filter rather than a cross-tenant read (see Auth and security).

### `daily_metrics` is written but barely read

The pipeline upserts a row per source per day, and the **only** consumer is
`app/api/chat/route.ts` (last 14 days). The brief pipeline never reads history:
`prev_day`, `week_total`, `prev_week_total`, `days_since_last_ship` and
`days_since_last_signup` are all
re-fetched live from the source APIs on every run. A brief can compare to
yesterday only because it re-fetches yesterday.

The one genuinely historical value in a brief is `day_number`, a `count(*)` over
`briefs`.

**If you build streaks/memory on this table, read the trap recorded in
POST_MVP.md first.** Rows are missing whenever a collector failed, and a missing
row is not a zero.

---

## The daily pipeline

`generateBriefForUser(userId, dateStr?, { partial? })` in
`lib/brief/generate.ts`. Safe to re-run. Never throws because one source failed.

1. **Load** `user_settings` + `integrations`. No integrations → return `null`.
2. **Resolve the window.** Default is *yesterday* in the user's timezone.
   `lib/dates.ts` converts local days to UTC instants; nothing uses server-local
   time.
3. **Collect** from each connected source in parallel, each in its own
   `try/catch`. A failure pushes a line into `facts.gaps` and continues —
   **it does not write a `daily_metrics` row.**
4. **Store** each source's data as a `daily_metrics` upsert — **skipped entirely
   on a partial run**, which measures a slice of a day and must never stamp it
   onto the row representing the whole day (see [Partial briefs](#partial-briefs)).
5. **Compose** — `buildLedger()`, `baselineInsight()`, `baselinePriorities()`.
6. **Polish (optional)** — `polishWithLLM()` rewrites insight and priorities.
   Two attempts, validated against the allowlist; on failure the baseline wins.
7. **Store** the `Brief` as a `briefs` upsert.

### Scheduling

`/api/cron/hourly` **must run every hour.** Each run serves only the users whose
local time has just reached their `send_hour` and skips everyone else, so a less
frequent schedule silently drops entire timezones — no error, just users who
never receive anything. The endpoint is idempotent per (user, day), so extra
runs are harmless.

Vercel's Hobby plan allows only one cron per day, and a `vercel.json` declaring
an hourly schedule is **rejected at config validation** — before a build record
exists, so the Deployments list stays empty rather than showing a failure. Hence
the split:

| Source | Schedule | Role |
|---|---|---|
| `vercel.json` | `0 6 * * *` | Within the Hobby limit. Duplicate, harmless |
| `.github/workflows/hourly-brief.yml` | `0 * * * *` | **The real tick.** curls the production URL with `CRON_SECRET` |

The Action needs `CRON_SECRET` under repo → Settings → Secrets → **Actions**,
matching Vercel exactly, or the endpoint 401s. On Vercel Pro, set `vercel.json`
to `0 * * * *` and delete the workflow.

Two constraints that live in the workflow and are easy to undo by accident:
the production host is **hardcoded** there, so a domain change must be mirrored;
and because the repo is public its Actions logs are public, so a `200` body —
which lists user IDs — must never be echoed.

### Partial briefs

`{ partial: true }` covers midnight→now and compares against **the same hours**
of the previous day, never against a whole day — otherwise every mid-afternoon
brief shows a fake decline.

**A partial run never writes `daily_metrics`.** That row represents a whole day,
`chat` reads fourteen of them, and nothing revisits it to correct a slice. The
*brief* is still stored, because the UI re-reads it from the database — and it
is safe to store only because the cron regenerates over any row still flagged
`partial`. Both halves are load-bearing: with the brief unsaved the founder sees
nothing, and without the cron guard a brief generated at 22:15 froze that day at
22:15 and was emailed as final the next morning, hiding a commit pushed at 22:28.

### Choosing which day an on-demand brief covers

`/api/brief/generate` covers **yesterday**, and falls forward to **today so
far** only when yesterday's ledger is entirely zero. `?today=1` asks for today
directly and skips the fallback, because an empty "today so far" at 9am is the
honest answer to the question that was asked.

**It never falls backwards.** An earlier version searched for the last day with
any activity and generated a brief for that instead — which meant a founder
whose repo had been quiet for three weeks opened the page and was shown
`No. 3 · Covering Sun, Jul 26`. Arithmetically correct, and it reads as the
product losing track of what day it is. How long it has been is genuinely useful
information, but its useful form is the sentence "the last activity was 17 days
ago", not a brief dated three weeks back. A quiet day should look quiet.

Because the fallback changes the date, the route's callers navigate to
`/?date=<brief_date>` from the response rather than to `/`, which shows the
newest `brief_date`.

`isEmptyLedger()` ignores rows listed in `STANDING_ROWS` — currently "Open pull
requests". A standing count is the same number whether or not the founder did
anything that day, so counting it as activity would suppress the fallback on a
genuinely quiet day. Add any future state-not-activity row to that set.

**What a quiet day actually shows**, with no date-shifting anywhere: a ledger of
zeroes, plus `Nothing was pushed or deployed — the last activity was N days
ago`, plus `No new signups in N days`, plus an insight and one real instruction
("Ship something small today to break the drought"). That is the intended
answer to "a new user must never see zeros and no insight" — the zeroes are
true, and the surrounding lines carry the meaning. Resist adding more.

**The 7am email never falls forward either.** At 7am "today" is three hours old
and essentially always empty. The email states yesterday's date and carries the
last-activity line in `gaps`, so a quiet morning is informative without being
re-dated.

---

## Priorities: ranking and the score table

`baselinePriorities()` in `lib/brief/diff.ts`. **Returns 1–3, ranked, and
deliberately never pads to three.** `priorities[0]` is the lead — position
carries meaning, so anything that reorders this array changes the product.

Each rule builds a `Candidate { text, score, kind }`:

| Signal | Score | `kind` | Source |
|---|---|---|---|
| Funnel break — traffic up >20% w/w while signups flat or down | 100 | growth | traffic + product |
| **First revenue** — money today, none yesterday *and* none last week | 90 | growth | revenue |
| Signup stall — zero signups today *and* yesterday | 85 | growth | product |
| Ship drought — `days_since_last_ship >= 3` | 80 | shipping | github |
| Warm channel — yesterday's spike had a dominant non-direct source | 70 | growth | traffic |
| **Talk to yesterday's new paying customers** | 65 | growth | revenue |
| Talk to yesterday's new signups | 60 | growth | product |
| Stale open PR — oldest open PR ≥ 2 days | 55 | shipping | github |
| Fresh open PR | 30 | shipping | github |
| Generic fallback — "pick the one thing…" | 5 | none | — |

Then: **sort desc → keep `score >= PRIORITY_FLOOR` (25) → cap 3.** If nothing
clears the floor, return exactly the top scorer. Never zero, never four.

The floor sits just under the weakest real signal (fresh PR, 30) so the generic
fallback can never ride along beside a concrete instruction. On a quiet day the
brief says one true thing and stops.

### The insight must describe the same activity the numbers show

`baselineInsight()` originally spoke about GitHub only through merged PRs and a
three-day drought. For a founder who pushes straight to main, `prs_merged` is
permanently 0 and a same-day push means no drought — so GitHub contributed
nothing, and the whole function fell through to its default: *"A quiet day —
nothing shipped"*, printed directly above a ledger reading five commits and four
deployments. **A row of numbers and a sentence that contradict each other are
worse than either being sparse**, because the reader cannot tell which one is
lying.

The same hole existed in `baselinePriorities()`, which produced *"Pick the one
thing that would make today a win"* on a day with five commits — a brief that
visibly had not noticed. Both now have a commits-and-deployments branch. When
adding a metric to the ledger, add it here too, or it will be a number nothing
can talk about.

### Connecting a tool is never a priority

There is no candidate for it in the scorer, and the LLM is forbidden from
inventing one — by a rule in the system prompt *and* by `isConnectorChore()` in
`lib/brief/generate.ts`, which drops any priority naming a provider **and** a
setup word before validation. If that empties the list, the whole polish attempt
is rejected and the deterministic baseline ships.

Enforced twice because the prompt alone is a request, not a guarantee, and this
failure is self-selecting: it surfaces on the quiet days when there is least
else to say, and lands in `priorities[0]` — the lead. A founder opened their
brief and was told THE MAIN TODO was "Address analytics connection". That is our
data-collection problem wearing their to-do list. `gaps` already states what
isn't connected, quietly, at the foot of the page; it is not a source of work.

The filter needs both halves of the match so a real instruction that happens to
name a tool ("check Stripe for failed payments") still passes.

**Why the two revenue rules sit where they do.** First revenue is the rarest
signal a brief can carry and the one most worth acting on the same day, while
the cause is still identifiable — but it ranks *below* a funnel break, because a
leaking funnel caps everything that follows it. Talking to a paying customer
outranks talking to a free signup by one notch: a payer has already answered the
question a signup only hints at. Note the asymmetry these rules removed —
`baselineInsight()` had handled revenue since Stripe shipped, so revenue could
reach the ledger and the insight but **never the todo list**.

**Goal bonus.** `goalBonus()` adds `GOAL_BONUS` (15) when the founder's
`goal` text matches a `GOAL_THEMES` pattern whose `kinds` include the
candidate's `kind`. This is the **only** place `goal` reaches the deterministic
path — everywhere else it merely tints the LLM's prose. It reorders candidates
the facts already justify and can never introduce one.

One consequence worth knowing: `GOAL_THEMES` maps revenue words
(`/revenue|paying|money|mrr|monet|sales|charge|pricing/`) to `growth`, and both
revenue rules are `growth`. A founder whose stated goal mentions revenue
therefore lifts first-revenue to **105 — above the funnel break**. That is
intended, but it is the only way any rule outranks the 100.

When adding a signal: give it a score relative to this table, a `kind`, and use
the local `add()` helper so the goal bonus applies. Then re-check the quiet-day
case — that a slow morning still yields exactly one instruction.

### Worked example

Four scenarios against the same base facts (412 visitors with Twitter dominant,
31 signups, one 3-day-old open PR, shipped yesterday). Produced by calling
`baselinePriorities()` directly — the fastest way to check a scoring change, per
[Known issues](#known-issues-and-footguns).

| Facts | Ranked output |
|---|---|
| Revenue rising ($348, up $108 — *not* first money) | 1. Warm channel (70) · 2. Paying customers (65) · 3. New signups (60) |
| First revenue this week ($348, nothing prior) | 1. **First revenue (90)** · 2. Warm channel (70) · 3. Paying customers (65) |
| No Stripe connected | 1. Warm channel (70) · 2. New signups (60) · 3. Stale PR (55) |
| One new customer, no traffic/github | 1. Paying customers (65) · 2. New signups (60) |

Two things this pins down. There is **no rule for revenue merely rising** — only
first money scores. On a growing-revenue day the sole revenue candidate is the
payer rule at 65, which the warm channel outranks, and that is the right
outcome: the channel is what caused the revenue. Add a rising-revenue rule only
if you want revenue to lead most days a founder has Stripe connected.

Second, the stale PR (55) drops off the sample day entirely once the payer rule
(65) exists — three slots, and it is now fourth. Adding a mid-scoring rule
silently evicts the weakest existing one; check what falls off, not just what
appears.

The last row is also why the payer rule carries a separate singular string. The
plural form renders "one of yesterday's 1 new paying customer" at `n = 1`.

---

## Rendering: two surfaces, no shared template

A `Brief` is rendered twice by **independent** code:

- **Web** — `components/BriefView.tsx` (Tailwind). Used by the home page,
  `/preview`, and the sample brief on the landing page.
- **Email** — `renderBriefEmail()` in `lib/email/send.ts`. Inline styles and
  table layout, because email clients discard stylesheets and pseudo-elements.

They cannot share a template. **Any change to a brief's copy or layout must be
made in both, or they drift.** The lead-priority block is the current example:
`border-l-2` utility on the web, hand-written `border-left` on a `<td>` in email.

`Brief.priorities` is a plain `string[]`; the lead is simply index 0. Keeping it
a flat array is deliberate — briefs stored before ranking existed still render,
with their first item becoming the lead.

**Ledger row order and gating** (`buildLedger()`): users and market first, then
**Commits pushed**, then **Deployments**, then the two PR rows *only when*
`uses_prs !== false`. Commits leads the shipping rows because a merged PR's
commits land on the default branch too — it is the superset, not the
alternative, and the one figure that means the same thing in every workflow.
Deployments renders **including at zero**: hiding it on quiet days meant "nothing
deployed" was the only state that appeared as absence rather than as a number.
`uses_prs` is absent on briefs stored before it existed, so `!== false` keeps
those rendering unchanged.

**One animation exists beyond `.rise`:** `.dots` in `globals.css`, three
staggered-opacity dots used while a connector step waits several seconds for a
project key and schema read. It is kept typographic rather than a spinner — no
new shape, no colour — and is disabled under `prefers-reduced-motion` alongside
`.rise`. Note this is a deliberate exception to `BRANDING.md` §4, which states
no animation exists besides `.rise` and `transition-colors`; that document has
not been amended.

### The masthead

`components/Wordmark.tsx` is the mark-plus-name used by all seven web mastheads
(brief, landing, home, login, onboarding, settings, privacy, terms). It always
links to `/`, which resolves to the landing page logged-out and today's brief
logged-in — so one `href` is correct everywhere and no caller decides.

The mark is **inline SVG in `currentColor`**, not an image. It inherits whatever
theme token it sits in, so it inverts with light/dark through the same
`prefers-color-scheme` block in `globals.css` that drives everything else. There
is no second asset and no image swap; do not add one.

Two deliberate exceptions:

- **`<Wordmark linked={false}/>`**, via `BriefView`'s `sample` prop, for the
  specimen brief embedded on the landing page. That page owns its own masthead,
  so a linked one inside the specimen would be a duplicate home link and would
  turn an illustration into navigation. `/preview` is a real page and *does*
  link.
- **The email masthead has no mark.** `renderBriefEmail()` keeps plain text,
  because inline SVG is stripped by most clients and a remote image would be
  blocked by default. This is a divergence on purpose — see the drift warning
  above — not an oversight to "fix".

**The masthead date carries a label** — `Covering Thu, Aug 6` or `Today so far`,
never a bare date. A masthead reads as an *issue* date; this one is the period
the brief covers, and unlabelled it was read as the page being stale. The email
masthead says `Covering …` for the same reason.

`TodayBrief` (`?today=1`) appears in **two places, by state**:

- **On a finished brief** it sits in the masthead beside the date, labelled
  "Today so far →". That is where the ambiguity about which day you are reading
  lives, so that is where the switch belongs.
- **On a partial brief** the masthead switch is gone — you are already on today
  — and it moves to the **footer beside `Refresh`**, labelled "Refresh today".
  There it is re-reading the day you are on, which is an action like the others
  rather than a change of view.

Hiding it entirely on partial briefs was wrong: today keeps moving, and
`Refresh` regenerates *yesterday*, so there was no way to re-read today at all
after committing again.

Two other web-only controls, both absent from the email because it can't hold
state or use relative links:

- **`Connect a tool →`** under `gaps`, shown only when a gap says something
  isn't connected. Deliberately here and nowhere else: see
  [Connecting a tool is never a priority](#connecting-a-tool-is-never-a-priority).
- **`Disconnect`** on each connected onboarding step, via the shared `Done`
  component and the existing `DELETE` endpoint. Correcting a mis-picked table
  used to mean a trip to Settings.

**Onboarding steps are keyed on their connected flag.** `router.refresh()`
re-renders the server component with fresh props, but React keeps client state
across it — `useState` reads its initial value only on mount, so a disconnected
step went on showing "✓ connected" until a hard reload. The key forces a
remount; a matching effect clears the parent's copies, which gate the Generate
button. The Supabase step is deliberately **not** keyed on `pickingProject`,
which changes mid-flow and would discard the project list being chosen from.

The favicon is a separate, unrelated asset: `app/icon.svg` keeps a black plate
and does **not** track the theme, because it is drawn on browser chrome and in
search results rather than on the page. `icon1.png` / `apple-icon.png` are its
raster fallbacks, regenerated by `scripts/generate-icons.mjs`.

### The sample brief

`lib/sample.ts` feeds the landing page and `/preview` with fake-but-honest data,
and doubles as the design reference. It models a founder with **all four
integrations connected** — including Stripe, so the ledger carries `Revenue` and
`New customers` and the gaps footer is empty.

Keep it reproducible by the engine. Its rows must match what `buildLedger()`
emits for those facts (revenue between signups and shipping; `New customers`
carrying no delta) and its priorities must be ones `baselinePriorities()` could
rank. It previously showed `"Stripe isn't connected — revenue isn't being
tracked."` — a string `findGaps()` cannot actually produce, advertising a
limitation the product does not have.

### Search visibility

**Only the homepage is offered to crawlers.** `public/robots.txt` is a static
file — not Next's generated `app/robots.ts` — and reads:

```
User-agent: *
Allow: /$
Disallow: /
```

`Allow: /$` matches the root and nothing else; the bare `Disallow: /` covers
everything below it. Google and Bing resolve the overlap by longest match, so
Allow wins for `/` alone. Two consequences worth knowing before changing it:

- This governs **crawling, not indexing.** A disallowed URL someone links to can
  still be listed as a bare link with no description. Hard exclusion needs a
  `noindex` header, which requires the page to be crawlable to be seen — so the
  two cannot be combined on one path.
- `/preview` is public and is the strongest marketing page in the app, but it is
  currently disallowed along with everything else. That was the deliberate ask,
  not an oversight.

There is **no sitemap**. If you add one, its URLs must not contradict
robots.txt — crawlers report that as an error.

The search listing itself comes from `metadata` in `app/layout.tsx`:

| Part | Source | Constraint |
|---|---|---|
| Blue link | `title.default` | under ~60 chars or Google truncates it |
| Grey subtext | `description` | ~150 chars is what gets shown |

`title.template` (`"%s | Founder Brief"`) means **sub-pages must set a bare
title** — `title: "Privacy"`, not `"Privacy | Founder Brief"` — or the brand
appears twice. There is no `metadataBase`, no OpenGraph block and no
`opengraph-image`, so a shared link previews as plain text with no card. That is
a deliberate omission, not missing work.

---

## Collectors

One file per source in `lib/collectors/`, each ~30–120 lines of fetch-and-shape.
No SDKs: GitHub, Plausible and Stripe are called over plain REST, and the
founder's Supabase over PostgREST. Resist building an integration framework —
see POST_MVP.md standing rule 5.

Each collector exports a `collectX()` for the day plus window helpers for the
comparison periods, and most export a `verifyX()` used at connect time so a bad
key is rejected **before** anything is stored.

Notable per-source behaviour:

- **GitHub** — authenticated per *installation*: `generate.ts` mints a token
  from `lib/github/app-auth.ts` rather than decrypting a stored one, and
  `listRepos` reads `/installation/repositories` (an installation token gets 403
  from `/user/repos`). Pull requests are read per-repo rather than through
  `/search/issues`, because search under an installation token can come back
  empty for private repos *without erroring* — which would silently hollow out
  the shipping half of the brief. Repos are capped at 5, so the extra calls are
  immaterial against a 5,000/hour per-installation budget. PR titles are
  third-party-writable, so they're truncated to 140 chars and capped in count
  before reaching the LLM. `countCommits()` exists so the comparison day doesn't
  refetch every pull request just to read one number.

  **A 409 on the commits endpoint is an empty repo and really is zero. Anything
  else is not.** A 403 from a missing `Contents` permission, or a 404 from a
  repo that left the installation, is a *failure to read* — it surfaces in
  `unreadable_repos` and becomes a gap, because reporting an unread repo as "0
  commits" is the one thing this brief must never do.

  **`daysSinceLastShip()` counts a deployment, a merged PR, or a commit on the
  default branch** — whichever is latest. Counting merged PRs alone returned
  `null` forever for anyone pushing straight to main, which silently disabled
  the shipping gap, the shipping insight, *and* the drought priority. Pushing to
  main is the common case for a solo founder, not the exception.

  **`uses_prs`** is false when the repos show no PR activity at all (none open,
  none merged in 30 days). The ledger then hides both PR rows, and the LLM is
  told not to suggest opening or reviewing one. Two permanent zeroes at the top
  of the ledger are not information — they crowd out the rows that move.

  **`commit_subjects` is what makes an insight specific.** The messages arrive
  in the `/commits` response already fetched for the count, so collecting them
  is free — and without them the model receives `commits: 5` with no idea what
  was shipped, which is the ceiling on how good any insight can be. Four
  defences, because a commit message is text an attacker can write: first line
  only, control characters stripped and whitespace collapsed, truncated to 120
  chars and capped at 10, and merge commits and near-empty messages dropped
  (commit hygiene varies; ten "wip" lines are worse than a count).

  The fourth defence is the non-obvious one: **`commit_subjects` is excluded
  from `allowedNumbers()`.** That walker adds every digit it finds in a string
  to the LLM's quotable-number allowlist, so a commit reading "now at 10000
  users" would license the model to print 10000 as a collected figure and pass
  validation. Injection would have become fabrication. PR titles predate this
  and are unchanged; commit subjects arrive in far greater volume.
- **Supabase (founder's)** — counts are `HEAD` + `Prefer: count=exact`. Schema
  discovery reads the PostgREST OpenAPI root.

  **`lastRowAt()` is the one call that is not a count.** It issues
  `?select=<ts>&order=<ts>.desc&limit=1` to find the most recent signup, so the
  brief can say *"No new signups in 47 days"* instead of *"No new signups for
  two days"* — the old wording was true whenever yesterday and the day before
  were both empty, and read as though signups had stopped on Monday when the
  last one was months ago. Only the derived integer survives the call.

  This is a **deliberate, documented narrowing of Invariant 4**, and the landing
  page and privacy policy were both amended to describe it rather than the other
  way round. That ordering is the point: the promise is the constraint, so a
  future change here starts by deciding what you are willing to tell users, not
  by deciding what is convenient to fetch. If you ever want the invariant back
  in its absolute form, bucketed `HEAD` counts over widening windows
  (7/30/90 days) give "no signups in over 30 days" while reading nothing.
- **Plausible** — buckets by whole days in the *site's* timezone, so it cannot
  be windowed like the others; partial briefs say so explicitly.
- **Stripe** — capped at 3 pages/day; sums only the dominant currency rather
  than silently mixing.

### Adding one

1. `lib/collectors/<name>.ts` with `collect…` + `verify…`.
2. Extend the `provider` check constraint in a new migration, and the
   `IntegrationRow` union in `lib/types.ts`.
3. `app/api/integrations/<name>/route.ts` — Zod-validate, verify live,
   `encrypt()` the credential, upsert. If the source supports OAuth, prefer
   storing **no** credential: GitHub keeps only an `installation_id` in `config`
   and leaves `access_token` null. Guards in `generate.ts` must then key off
   `config`, not `access_token`.
4. Wire into `generateBriefForUser` in its own `try/catch` that pushes to
   `facts.gaps` on failure.
5. Add rows to `buildLedger()` and, if it justifies advice, a scored candidate.
6. A step in `OnboardingFlow.tsx` and a `detail` line in `app/settings/page.tsx`.

---

## The paywall: six walls

Free connects two tools, Founder connects all four. That count is the **entire**
paid boundary — briefs, chat, the daily email and on-demand generation are
identical on both tiers, and nothing else is gated.

A connector is one row in `integrations`, and rows are created down six code
paths. Each path carries a check, and they are not interchangeable:

| # | Where | Kind |
|---|---|---|
| 1 | `integrations/github/authorize` | pre-check |
| 2 | `integrations/github/callback` | enforcement |
| 3 | `integrations/supabase/authorize` | pre-check |
| 4 | `integrations/supabase` — `save-oauth` branch | enforcement |
| 5 | `integrations/plausible` | enforcement |
| 6 | `integrations/stripe` | enforcement |

**The four enforcement walls are what make the limit real.** They sit at the
write. Remove any one and the limit is bypassable by calling that endpoint
directly, because none of them can rely on the UI having hidden a button.

**The two pre-checks enforce nothing the others don't.** They exist because both
OAuth legs cost the user something *before* the write is reached: `authorize`
sends them to install a GitHub App on their repositories, or to grant Supabase
Management API access to their whole organisation. Refusing only at the callback
would mean they granted a third party access for a connection that was never
going to be allowed. The pre-check is courtesy; the callback is the boundary,
and it stays because the callback is reachable directly.

Placement within each route matters twice more. Wall 2 sits *before*
`getInstallationToken`, so a refused install never mints a token. Walls 5 and 6
sit *before* their `verify*` calls, so a refusal costs no round trip to
Plausible or Stripe.

**`github/repos` is deliberately not gated.** It updates `config.repos` on a row
that already exists; gating it would break repo re-selection for free and paying
users alike. Only *creating* a connector is limited.

### The subtlety that will break if someone "simplifies" it

`canAddConnector(userId, provider)` in `lib/billing.ts` counts the user's
connectors **excluding the provider being written**, then compares to the limit.

That exclusion is load-bearing. Every connector route writes with `upsert`, so a
plain `count >= LIMIT` would refuse a free user at their limit who is re-saving
something they already have — rotating a leaked Plausible key, or re-running the
GitHub App install to change which repositories it can see (`setup_action=update`
re-enters wall 2 for a user who already has a `github` row). They are at two, and
one of the two is the row being rewritten. The exclusion makes the check ask "is
this a new tool?" rather than "are you at the limit right now?".

`app/onboarding/page.tsx` mirrors the same rule client-side to decide which
steps render locked, counting raw `integrations` rows rather than the filtered
connection flags — a legacy `github` row with no `installation_id` displays as
disconnected but is still a row the server counts, and the two must agree about
who is at the limit.

### Downgrade is grandfathering

When a subscription ends the webhook sets `tier = 'free'` and nothing else
happens. Existing connectors keep collecting; only new ones are refused. No
revocation logic, no "which two do we keep" decision, and — the reason it is
written this way — a failed payment retry never destroys the encrypted
third-party credentials in `integrations.access_token`.

---

## Auth and security

What is in place today, in one list — the sections below give the reasoning:

| Control | Where |
|---|---|
| No GitHub credential stored; tokens minted per run | `lib/github/app-auth.ts` |
| Supabase management token used once, never stored | `lib/supabase-oauth.ts` |
| No pasted-key path — OAuth is the only way to connect Supabase | `integrations/supabase/route.ts` |
| Stripe restricted keys only (`rk_`), enforced at the boundary | `integrations/stripe/route.ts` |
| Credentials AES-256-GCM encrypted at rest | `lib/crypto.ts` |
| Every decrypt logged with the user id | `lib/crypto.ts` |
| Zero-downtime key rotation via `ENCRYPTION_KEY_OLD` | `scripts/rotate-encryption-key.mjs` |
| `Secure` cookie flag from `NODE_ENV`, not from a URL | `lib/cookies.ts` |
| `anon` / `authenticated` hold no table grants at all | migration `0003` |
| RLS enabled on all six tables, owner-scoped `select` | migration `0001` |
| Tenant scoping enforced mechanically | `npm run check:scoping` |
| `SECURITY DEFINER` functions not callable over the API | migration `0002`, plus a manual revoke on Supabase's `rls_auto_enable()` |
| SSRF bounded — no endpoint accepts a URL from the client | `projectRef` regex |
| Prompt-injection clause in both system prompts | `brief/generate.ts`, `api/chat` |
| Cron bearer token compared with `timingSafeEqual`, fails closed | `api/cron/hourly` |
| Rate limits: 30 chat/5min, 1 brief/30s | per route |
| Billing webhook authorised by Stripe signature, not session | `api/billing/webhook` |
| Checkout return verifies the session belongs to the caller | `api/billing/return` |
| Tier is never client-trusted; `/api/settings` cannot write it | zod allowlist in `api/settings` |
| Billing key is restricted (`rk_`), four permissions | `lib/stripe.ts`, README §5.2 |
| Stripe customer deleted before the account cascade | `api/account` |

**Sign-in** is an emailed OTP verified in the browser
(`app/login/page.tsx`) — not a magic-link redirect. The code length is a
Supabase *project setting* (currently 8, valid 6–10); never hardcode or truncate
it. Never retry `verifyOtp` with a different `type` on failure — a failed
attempt can invalidate the token and turn a typo into a dead code.

**`middleware.ts`** refreshes the session on every request and gates
non-public paths. Because Supabase rotates refresh tokens, rotated cookies are
replayed onto redirect responses too — dropping them silently signs the user
out. The `github/callback` and `supabase/callback` routes are deliberately
public so the provider's one-time redirect reaches its handler; the
`gh_oauth_state` / `sb_oauth_state` cookies are the actual CSRF guard, and each
handler re-checks the session itself.

**Least privilege is the design, not a nicety.** Two invariants here are easy to
undo by accident and expensive to undo in public:

- **GitHub stores no credential.** The App holds read-only permissions and the
  row carries an `installation_id`; tokens are minted per run in
  `lib/github/app-auth.ts`. Reverting to an OAuth App would mean the `repo`
  scope — read *and write* on every private repo — because GitHub offers no
  read-only alternative there.
- **There is no manual/pasted-key path.** OAuth is the only way to connect
  Supabase. The pasted-key flow was removed: it was the single place a founder
  was asked to hand a `service_role` key to a web form, it doubled the connect
  surface, and its only genuine audience was self-hosted Supabase. Do not
  reintroduce one as a convenience.
- **The Supabase management token is discarded.** It can read API keys for every
  project in the user's organisation, so it lives only in a 10-minute encrypted
  cookie and is dropped once one project's key is fetched
  (`lib/supabase-oauth.ts`). Persisting it "so refreshes are easier" would trade
  a per-project credential for org-wide standing access. The refresh token in
  the exchange response is deliberately ignored.

**Secrets at rest** — every credential we *do* keep is AES-256-GCM encrypted by
`lib/crypto.ts` before it touches `integrations.access_token`. `decrypt()` takes
a `context` (the user id) and logs one line per call: reading a customer's
credential is the most sensitive operation here and used to leave no trace, so a
bulk read looked exactly like a normal night's generation.

**The Supabase project key is the largest asset this app holds**, and it is held
knowingly, not by oversight. Counting rows a founder's own RLS hides requires a
credential that bypasses RLS, and Supabase offers no read-only variant of that.
The alternatives were each tried and rejected: a publishable key returns `0` on
any RLS-protected table, so the product simply does not work; installing a
counting function via the Management API would need a *write* scope on the OAuth
app; and storing the refresh token to re-mint keys trades a per-project
credential for org-wide standing access. **One-click OAuth, read-only scope, and
not holding a powerful key: pick two.** If you revisit this, revisit that
trilemma rather than assuming a fourth option exists.

Note that "the OAuth app is read-only" does not make the outcome read-only:
reading is exactly how the `service_role` key is obtained
(`GET /v1/projects/{ref}/api-keys?reveal=true`). Read-only bounds what we can
change in a founder's account, not what we can learn from it.

**`Secure` on cookies comes from `NODE_ENV`, never from a URL** (`lib/cookies.ts`).
It previously read `NEXT_PUBLIC_APP_URL.startsWith("https")`, and that variable
was `http://…` in production for a period — silently dropping `Secure` from the
OAuth state cookies and from the management-token cookie. A security property
must not be one typo in an environment variable away from off.

**Key rotation is zero-downtime, and only if done in order.** `decrypt()` accepts
`ENCRYPTION_KEY` and, when set, `ENCRYPTION_KEY_OLD`, so production reads rows
under either while a rewrite is in progress. Without that second key there is an
unavoidable gap: the script re-encrypts rows in the database, but the running
deployment holds the previous key until a new build is live, and every read
between the two throws. **The full step-by-step runbook lives in the header of
`scripts/rotate-encryption-key.mjs`** — follow it there rather than improvising;
the order is what makes it safe, and getting it wrong makes every stored
credential unreadable. Unset `ENCRYPTION_KEY_OLD` once the rewrite reports
`failed 0`, or a compromised environment yields two live keys instead of one.

**`npm run check:scoping`** fails the build if a service-role query lacks
`.eq("user_id", …)`. RLS cannot catch that omission — bypassing RLS is the point
of the role — so this is the only mechanical guard on the invariant below.
Exceptions live in an `ALLOWED` list in the script and each needs a reason;
there is currently one, the cron's deliberate walk over every user. Stripe accepts
restricted keys only (`rk_`); `scripts/audit-stripe-keys.mjs` reports rows
holding an `sk_` from before that was enforced.

**The service-role client bypasses RLS.** `createAdminClient()` carries no user
context, so **every query must be scoped by `.eq("user_id", …)` explicitly**. A
missing filter is a cross-tenant data leak, and RLS will not catch it. This is
the single most dangerous omission possible in this codebase — and in the brief
pipeline it is worse than a normal leak, because `allowedNumbers()` would make
another tenant's figures quotable in a founder's prose.

**Prompt injection.** Anything a user or third party writes is untrusted input
to the LLM: PR titles, the founder's `goal`, and any field added later. Both
system prompts (`lib/brief/generate.ts` and `app/api/chat/route.ts`) carry an
explicit clause naming these as data, not instructions. **Extend that clause
whenever you add a free-text field to either context.**

**SSRF** — the founder's Supabase URL is fetched server-side, so it's
constrained to `https://<sub>.supabase.(co|com)` with no port. Table and column
names are validated as Postgres identifiers because they end up in a URL path.

**Rate limits** — 30 chat messages / 5 min / user (DB-backed, so it holds across
serverless instances); one manual brief / 30s / user.

**Account deletion is a single `auth.users` delete** (`DELETE /api/account`).
All six tables cascade from it, so there is no cleanup list to maintain — and
deliberately so, because a hand-written list is what falls out of date when a
table is added. Confirmation is the user typing their own email address, not a
word: it cannot be produced by muscle memory. There is no grace period; a soft
delete would mean a `deleted_at` column threaded through every query.

Two things deletion cannot reach, and the UI says both: the GitHub App stays
installed until the user removes it, and Supabase keeps its record of the OAuth
authorisation. Neither can reach anything once the row is gone.

### Knowing when a brief fails

Two separate things, often confused. One is a status code, one is an email.

**1. The route returns 500 when the whole run fails.** If the cron cannot even
list its users it returns `500`, not `{ ok: true }`. This is not a feature or a
notification — it is the route reporting what happened. It previously returned
200 in that case, claiming success while doing nothing.

There is nothing to configure here and nothing to switch off; "off" would mean
lying about the outcome. What it *causes* is configurable, but in GitHub rather
than in this repo: a 500 fails the Action, and GitHub emails the account about a
failed workflow. Change or silence that under GitHub › Settings › Notifications
› Actions.

**2. `ALERT_EMAIL` gets an email when individual users fail.** One variable is
both the switch and the recipient — unset means off. It fires only when at least
one user errored, so silence is the normal state, and it is wrapped in
`try/catch` because a broken alert must never become a broken brief.

**Both exist because neither covers the other's case.** If the database is
unreachable the loop never runs, so no user is ever marked failed and the alert
email never fires — the total-failure case is exactly the one the email cannot
see. Conversely a 200 run where three users errored keeps the Action green.

**The alert carries stage names, counts and user ids — never the error text.**
That is the one design decision in it. A `fetch` error can quote a URL with a
key in it, a PostgREST error can quote the query, and an OpenAI error can quote
the prompt, which holds PR titles and `founder_goal`. Detail stays in the Vercel
logs, which are access-controlled. This is also why the alert needs no retention
policy and no privacy-page commitment beyond naming it: it creates no new store
of personal data.

---

## Known issues and footguns

**Scheduled briefs depend on a GitHub Action, not on Vercel.** See
[Scheduling](#scheduling) — `vercel.json` alone cannot deliver briefs, and the
Action is the piece that silently stops.

**Two traps in `scripts/*.mjs`, both hit once already.**
`supabase-js` builds a Realtime client the moment you call `createClient()`, so
importing it in a plain Node script throws *"Node.js 20 detected without native
WebSocket support"* even when nothing subscribes to anything — talk to PostgREST
over `fetch`, or use `GoTrueClient` directly for auth. And `.env.local` cannot be
parsed line-by-line: `GITHUB_APP_PRIVATE_KEY` is a quoted multi-line value, and a
naive parser silently truncates it to its `-----BEGIN` line, which then fails far
away with an opaque OpenSSL error. Both scripts share a `parseEnv()` that handles
quoted multi-line values; copy it rather than rewriting one.

**A GitHub App's Setup URL, not its Callback URL, is what returns the user after
an install.** Leave Setup URL blank and installs end on github.com: the callback
never runs, no row is written, and the only symptom is a Connect button that
never changes — with nothing in the logs, because no request reached the server.
README section 2 has the setting.

**`maxDuration = 60` and sequential users.** The cron processes users in a `for`
loop, each costing ~6–12 external API calls. See POST_MVP.md Stage 3 — batch
with `Promise.allSettled` first, then move to a queue.

**GitHub disables scheduled workflows after 60 days of repo inactivity.** Since
that workflow *is* the brief schedule, a quiet stretch stops every user's 7am
email with no error anywhere. Any commit re-enables it. Scheduled runs are also
best-effort and can land minutes late.

**Nothing alerts on a missed brief.** A failed or skipped 7am delivery produces
no signal — `console.error` in a serverless log nobody reads. This is the
highest-value operational gap in the product today; POST_MVP.md Stage 0 lists
error alerting for exactly this reason.

**A failed collection writes no row.** Do not infer "zero" from an absent
`daily_metrics` row.

**The Stripe Customer Portal must be activated per environment, and its absence
looks like a code bug.** Settings → Billing → Customer portal, separately in
sandbox and in live. Without it `billingPortal.sessions.create` throws a
configuration error at runtime — nothing in the code is wrong, and nothing in
the dashboard says so.

**Granting the tier does not depend on a webhook arriving.** A webhook is a
push, and pushes fail — the local relay stops, a deploy lands mid-delivery, the
endpoint is briefly unreachable — and if it were the only path then every one of
those means somebody paid and the app never found out. So there are three
layers, in order of when they act:

1. **`/api/billing/return`** — where Checkout sends the customer back. It
   *retrieves the session from Stripe* and grants the tier there and then.
   Nothing has to be delivered for this to work, and it covers the only moment
   that matters most: the one where money has just changed hands.
2. **`/api/billing/webhook`** — everything that happens with nobody present:
   renewal failure, cancellation at period end, an expiring card.
3. **`scripts/audit-billing.mjs`** — reconciles both directions
   against Stripe when the first two have missed something.

The ownership check in layer 1 is not optional: `session_id` arrives in a query
string, so without verifying the session's customer against the caller's stored
`stripe_customer_id`, any signed-in user could paste a stranger's session id and
be upgraded on their payment.

**`stripe listen` only relays while it is running, and does not queue.** A local
event sent while it is down is gone — Stripe never saw a failure to retry. This
is a development-only concern; in production Stripe posts directly and retries
failures for days. The secret it prints is also a *different value* from a hosted
endpoint's, so carrying one across fails every signature check while looking
configured.

**`past_due` still counts as paid.** Stripe retries a failed card for around two
weeks; demoting on the first decline creates support work for someone who is
about to pay. See `PAID_STATUSES` in `lib/stripe.ts`.

**Account deletion must cancel Stripe before the cascade, not after.** The
cascade destroys `stripe_customer_id`, which is the only link to the
subscription — reverse the order and a deleted user is billed forever with no
record left to find them by. `scripts/audit-billing.mjs` is the
backstop for when the in-request cancellation and its alert both fail.

**`lib/sample.ts` is public-facing.** It renders on the landing page, so
changing the `Brief` shape can break the marketing site, not just the app.

**No tests.** `npx tsc --noEmit` is the only gate. For pure functions like
`baselinePriorities`, the fastest way to verify behaviour is a throwaway script
run with `npx tsx --tsconfig tsconfig.json <file>.ts` — tsx resolves the `@/`
alias from `tsconfig.json`, so the script imports the real module directly and no
compile step or hand-built JS is involved. Drive it with a base facts object and
spread overrides per scenario; the [worked example](#worked-example) above is
that script's output.

---

## Keeping this current

Update this doc in the same change as the code when you:

- add or remove a **table, column, or migration** → Data model
- add or remove a **collector / provider** → Collectors, Directory map
- change **priority signals, scores, the floor, or the cap** → the score table
  **and** the worked example, which is the only place the interactions are visible
- change what a **brief contains or how it's laid out** → Rendering (and confirm
  both surfaces were changed)
- change the **masthead, the mark, or the favicon** → Rendering › The masthead
- change **`robots.txt`, page `metadata`, or add a sitemap** → Rendering ›
  Search visibility (robots.txt and a sitemap must agree)
- change **`lib/sample.ts`** → re-check it against `buildLedger()` and
  `baselinePriorities()`; a demo the engine can't reproduce is a false claim
- change the **pipeline order**, the partial-brief rule, **which day a brief
  covers**, or LLM validation → the pipeline section and Invariants
- change **auth, RLS, grants, encryption, or rate limits** → Auth and security
- change the **cron schedule, the workflow, or the production domain** →
  Scheduling
- add a **table that stores user data** → give it `on delete cascade` on
  `auth.users(id)`, or `DELETE /api/account` quietly stops being complete and
  the privacy policy stops being true
- add state in an **external system that survives account deletion** → cancel or
  delete it in `DELETE /api/account` before the cascade runs. The cascade only
  reaches this database; a Stripe subscription outlives it and keeps charging a
  user who no longer has an account
- change **what the free tier includes, or where connectors are created** → the
  paywall section's table of six walls, and the exclusion rule in
  `lib/billing.ts` that the wall behaviour depends on
- fix or newly discover a **silent failure** → Known issues
- add an **animation, or anything else `BRANDING.md` forbids** → say so in
  Rendering *and* decide whether the branding rule is being amended or excepted;
  an undocumented exception is how a design system quietly stops being one

Deferred work with its reasoning belongs in [POST_MVP.md](POST_MVP.md), not here.
This file describes what *is*.
