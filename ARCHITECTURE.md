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
4. **The founder's database is counted, never read.** `lib/collectors/supabase.ts`
   issues `HEAD` requests with `Prefer: count=exact`. Row contents never leave
   the founder's project. Do not add a collector that selects rows.
5. **Idempotent by `(user_id, date)`.** Every write is an upsert on that key.
   This is what makes retries and re-runs safe; keep it.
6. **Honest gaps.** A missing integration or a failed collection is stated in
   the brief's `gaps` array, not hidden.
7. **One page, no dashboard.** No charts, no filters, no tabs.

---

## Stack

Next.js 14 App Router · React 18 · TypeScript · Tailwind · Supabase
(Postgres + Auth) · OpenAI · Resend · deployed on Vercel.

No test framework, no ESLint config, no state library. `npx tsc --noEmit` is the
only automated check that exists today.

### Environment variables

| Var | Used by |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` | browser + server auth clients |
| `SUPABASE_SERVICE_ROLE_KEY` | `createAdminClient()` — every DB read/write |
| `ENCRYPTION_KEY` | AES-256-GCM for integration tokens; **32-byte base64** |
| `OPENAI_API_KEY` / `OPENAI_MODEL` | brief polish + chat (default `gpt-4o-mini`) |
| `RESEND_API_KEY` / `EMAIL_FROM` | the 7am email |
| `NEXT_PUBLIC_APP_URL` | OAuth redirect URI, email links |
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` | GitHub OAuth app |
| `CRON_SECRET` | cron bearer token; **fails closed if unset** |

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
    integrations/             github/{authorize,callback,repos}, supabase, plausible, stripe
  auth/callback/              Legacy OAuth-code safety net; not the primary sign-in
lib/
  brief/generate.ts           The pipeline. Orchestrates everything below
  brief/diff.ts               Deterministic engine: ledger, insight, priorities, allowlist
  collectors/*.ts             One file per data source. Fetch and shape only
  email/send.ts               Brief object → inline-styled HTML email
  supabase/{admin,server,client}.ts
  crypto.ts  dates.ts  types.ts  sample.ts
components/
  BriefView.tsx               The brief, on the web
  Wordmark.tsx                Masthead mark + name; the link home on every page
  Landing.tsx  OnboardingFlow.tsx  SettingsForm.tsx  Chat.tsx
scripts/generate-icons.mjs    Regenerates the favicon PNGs from app/icon.svg
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
| `user_settings` | timezone, `send_hour`, `email_enabled`, `goal`, `onboarded_at`, `last_generate_at` | settings API, generate route, cron | cron, pipeline, chat, pages |
| `integrations` | provider, **encrypted** `access_token`, `config` jsonb | integration routes | pipeline, onboarding, settings |
| `daily_metrics` | one row per (user, date, source) | pipeline | **chat only** — see below |
| `briefs` | the rendered `Brief` object as jsonb, `emailed_at` | pipeline, cron | home page, chat |
| `chat_messages` | conversation history | chat route | chat route |
| `tool_requests` | "I use X" votes for the roadmap | tool-request route | you, manually |

A `user_settings` row is created by an `auth.users` insert trigger (migration
`0002`), **not** by application code — a user without one silently receives
nothing forever, which is why it lives in the database.

### `daily_metrics` is written but barely read

The pipeline upserts a row per source per day, and the **only** consumer is
`app/api/chat/route.ts` (last 14 days). The brief pipeline never reads history:
`prev_day`, `week_total`, `prev_week_total` and `days_since_last_ship` are all
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
4. **Store** each source's data as a `daily_metrics` upsert.
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
brief shows a fake decline. Used by the manual generate route when yesterday's
ledger is entirely empty, so a founder who connects at 3pm sees activity they
recognise rather than a page of zeroes. The 7am email never takes this path.

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

- **GitHub** — PR titles are third-party-writable, so they're truncated to 140
  chars and capped in count before reaching the LLM. Empty repos 409 on the
  commits endpoint and are counted as zero.
- **Supabase (founder's)** — `HEAD` + `Prefer: count=exact` only. Schema
  discovery reads the PostgREST OpenAPI root.
- **Plausible** — buckets by whole days in the *site's* timezone, so it cannot
  be windowed like the others; partial briefs say so explicitly.
- **Stripe** — capped at 3 pages/day; sums only the dominant currency rather
  than silently mixing.

### Adding one

1. `lib/collectors/<name>.ts` with `collect…` + `verify…`.
2. Extend the `provider` check constraint in a new migration, and the
   `IntegrationRow` union in `lib/types.ts`.
3. `app/api/integrations/<name>/route.ts` — Zod-validate, verify live,
   `encrypt()` the credential, upsert.
4. Wire into `generateBriefForUser` in its own `try/catch` that pushes to
   `facts.gaps` on failure.
5. Add rows to `buildLedger()` and, if it justifies advice, a scored candidate.
6. A step in `OnboardingFlow.tsx` and a `detail` line in `app/settings/page.tsx`.

---

## Auth and security

**Sign-in** is an emailed OTP verified in the browser
(`app/login/page.tsx`) — not a magic-link redirect. The code length is a
Supabase *project setting* (currently 8, valid 6–10); never hardcode or truncate
it. Never retry `verifyOtp` with a different `type` on failure — a failed
attempt can invalidate the token and turn a typo into a dead code.

**`middleware.ts`** refreshes the session on every request and gates
non-public paths. Because Supabase rotates refresh tokens, rotated cookies are
replayed onto redirect responses too — dropping them silently signs the user
out. `/api/integrations/github/callback` is deliberately public so the one-time
`?code=` reaches its handler; the `gh_oauth_state` cookie is the actual CSRF
guard, and the handler re-checks the session itself.

**Secrets at rest** — every third-party credential is AES-256-GCM encrypted by
`lib/crypto.ts` before it touches `integrations.access_token`.

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

---

## Known issues and footguns

**Scheduled briefs depend on a GitHub Action, not on Vercel.** See
[Scheduling](#scheduling) — `vercel.json` alone cannot deliver briefs, and the
Action is the piece that silently stops.

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
- change **`lib/sample.ts`** → re-check it against `buildLedger()` and
  `baselinePriorities()`; a demo the engine can't reproduce is a false claim
- change the **pipeline order**, the partial-brief rule, or LLM validation → the
  pipeline section and Invariants
- change **auth, RLS, grants, encryption, or rate limits** → Auth and security
- change the **cron schedule, the workflow, or the production domain** →
  Scheduling
- fix or newly discover a **silent failure** → Known issues

Deferred work with its reasoning belongs in [POST_MVP.md](POST_MVP.md), not here.
This file describes what *is*.
