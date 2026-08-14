# Founder Brief — Post-MVP Roadmap

Everything deliberately cut from the MVP, everything suggested since, and the
scaling path — organized into stages. Stages are gated by **triggers, not
dates**: don't start a stage because a month passed; start it because its
trigger fired.

The one metric that decides everything: **% of users who open their brief 4+
mornings in their first week.** Every stage exists to move that number or to
survive it going up.

---

## Stage 0 — Launch week (now → first 10 real users)

**Trigger: the deploy is live.**
Goal: 10 founders reading a *correct* brief every morning. Nothing else.

| Item | Why | Effort |
|---|---|---|
| Deploy (Supabase + Vercel + Resend + GitHub App + Supabase OAuth app) | The README runbook, ~15 min | XS |
| Onboard 10 founders by hand | Watch them connect; every stumble is a bug | — |
| Trust audit: verify every number in every brief for a week | One wrong number kills a user forever | S |
| ~~Error alerting~~ | **Shipped** — a whole failed run returns 500 so the Action goes red; per-user failures email `ALERT_EMAIL` with stage counts only. Next step is the `error_events` table (Stage 1 › Reliability) | — |
| ~~Self-serve account deletion~~ | **Shipped** — Settings › Delete account, confirmed by typing your own email. One `auth.users` delete; the six tables cascade | — |

**Explicitly do NOT build anything else during Stage 0.** Watch, fix, verify.

**If you take the repo private**, two things change and one is a cost. Vercel is
unaffected — the integration is a GitHub App, so deploys, previews and commit
metadata all work identically. The gain is that Actions logs stop being public,
which retires the standing footgun that the cron's `200` body lists user IDs and
must never be echoed. The cost is that **GitHub Actions minutes are unlimited on
public repos but metered on private ones** (2,000/month on the free tier), and
`hourly-brief.yml` is the real brief schedule — roughly 24 short runs a day. That
should sit inside the free allowance, but it stops being free-by-default, so
check the actual per-run duration in the Actions tab before assuming. If it ever
gets tight, the fix is not a longer interval — that silently skips timezones
(see ARCHITECTURE › Scheduling) — but moving the tick to a cheaper trigger.

---

## Stage 1 — Retention (10 → 100 users)

**Trigger: 10 users have received briefs for 2+ weeks and you know the
morning-open rate.**
Goal: make the brief indispensable, not just pleasant.

### 1a. Data sources (widen who the brief works for)

**Prioritize by the `tool_requests` table, not by this list's order** — onboarding
captures "I use X" votes; build the top-voted source first, for named users.

**Then sort by cost, which `Facts` decides for you.** The brief has four slots —
shipping, product, traffic, revenue (`lib/types.ts`). A source that *fills an
existing slot* is a collector, a route and an enum entry. A source that *needs a
new slot* changes `Facts`, the prompt, `buildLedger()`, the scored candidates and
the deterministic baseline — and every brief already stored. Judge a connector by
which of those it is, not by how popular the tool is.

| Feature | Notes | Effort |
|---|---|---|
| **Generic Postgres collector** | One connection-string integration covers Neon, Railway, Render, RDS, self-hosted — the highest-coverage single addition possible (the current "Supabase" collector is really a PostgREST client). Needs `pg` driver + read-only-role guidance | M |
| **Firebase/Firestore** | The other half of the indie-stack DB duopoly; count docs in a collection by timestamp field | M |
|---|---|---|
| ~~Stripe integration~~ | **Shipped pre-launch** (2026-07-11): gross revenue + new customers via restricted key. Still to do here: MRR (subscriptions API), churn events, failed-payment alerts | S (remainder) |
| **Stripe App** | Scoped 2026-08-12, deferred — see below. Replaces the pasted `rk_` key with a one-click install and a consent screen that names `charge_read` / `customer_read` | M + review |
| **PostHog analytics** | Most common Plausible alternative among startups; same collector pattern (`lib/collectors/`) | S |
| **Fathom / Simple Analytics** | Same pattern; each is ~30 lines | S each |
| **Vercel Analytics** | Popular but API access is plan-gated; investigate first | M |
| **Google Analytics** | Deliberately rejected in MVP (OAuth + quota complexity). Only build when non-technical founders are a proven segment | L |
| **Linear / GitHub Issues** | "3 issues closed, 2 opened" — extends shipping beyond PRs | M |
| **Guided read-only key flow** | Wizard that generates `CREATE ROLE brief_reader ... GRANT SELECT` SQL for the founder's Supabase. **Mostly solved** (2026-08-12) by Management API OAuth — hosted users never see a key. This is now only for the *manual* path, i.e. self-hosted Supabase | S (remainder) |
| **Lemon Squeezy / Paddle** | Revenue slot, same `RevenueDayData` shape as Stripe — a collector and an enum entry, no brief changes. Widens the funnel to founders who aren't on Stripe. Check OAuth support per-provider; don't assume it | S each |
| **Sentry or Vercel (errors & deploys)** | The signal the brief structurally lacks: every metric in `Facts` is positive-direction, so it can say "you shipped 4 PRs" but never "your error rate tripled after the 3pm deploy". Both have real OAuth. **Needs a new slot in `Facts`** — this is the expensive one, and the most valuable | L |

### 1b. Brief intelligence (make the insight smarter, still deterministic-first)

| Feature | Notes | Effort |
|---|---|---|
| **Weekly review (Monday edition)** | "Last week vs the week before" — the 5-minute Monday version of the daily 30-second read | M |
| **Goal tracking v2** | MVP stores one free-text goal. v2 parses a target ("100 users") and tracks it: "You said 100 users — you're at 62, +9 this week, on pace for Aug 3." The single highest-leverage retention feature in this list | M |
| **Founder context at onboarding** | Capture `stage` and a one-line `description` so advice can be situated. Scoped and deferred 2026-08-11 — see below | S |
| **Launch/event annotations** | "I launched on PH today" → future insights can attribute spikes to *known* events without guessing. Kills the biggest "cause unknown" frustration honestly | S |
| **Anomaly memory** | Diff engine reads back `daily_metrics` for baselines and streaks → "third consecutive day without a signup", "your best traffic day this month" become computable, not LLM-claimed. Scoped and deferred 2026-08-11 — see below | M |
| **More deterministic patterns** | Signup-to-visitor conversion trend, weekend-vs-weekday shape, PR review latency | S each |

#### Anomaly memory — scoped 2026-08-11, deliberately deferred

**The read path is the entire job.** `daily_metrics` is already *written* every
night by four upserts in `lib/brief/generate.ts`, and read back in exactly one
place: `app/api/chat/route.ts` (last 14 days, for chat context). The brief
pipeline itself never reads history — `prev_day`, `week_total`,
`prev_week_total` and `days_since_last_ship` are all re-fetched live from the
source APIs on every run. So a brief can compare to yesterday only because it
re-fetches yesterday. The only genuinely historical value in a brief today is
`day_number`, a `count(*)` over `briefs`.

Shape when built: one module reading ~35 days of `daily_metrics`, folding a
`memory` block into `Facts` before `buildLedger`. Put it *inside* `Facts` and
its numbers join the LLM allowlist for free — `allowedNumbers()` walks the whole
object. Derived fields: consecutive days without a signup, consecutive shipping
days, best traffic day in 30d, goal progress (only when the goal parses to a
single integer *and* signups are connected).

**The trap that caused the deferral — read this before implementing.**
`daily_metrics` has holes *by design*. When a collector fails, `generate.ts`
logs, pushes a line into `gaps`, and continues, writing **no row**. A naive
streak cannot distinguish *"row exists, value 0"* from *"no row at all"*, so a
single failed Supabase collection on a Tuesday makes Wednesday's brief announce
"third consecutive day without a signup" — which is false. In a product whose
entire moat is never printing a wrong number, that is the worst possible bug.
**A missing row must be treated as unknown and break the streak, not extend it.**

Two more reasons it waited: it does nothing in week one (streaks need 3+ days,
personal bests ~14) which is exactly when the first cohort decides whether to
keep opening the email; and it adds a per-user query to the cron hot path, which
Stage 3 below already flags as failing at 100–200 users.

**Deferring costs nothing.** The history accrues whether or not anything reads
it, so this can be built at any later point with full retroactive benefit. That
asymmetry is why it lost to smaller work at launch.

#### Founder context at onboarding — scoped 2026-08-11, deliberately deferred

Capture `stage` (idea / building / launched / revenue) and a one-line
`description`, so advice can be situated — "talk to yesterday's signups" is
right for B2C and useless for an enterprise sales motion.

**Why it waited:** `goal` today only tints prose. It is read in `generate.ts`
into `facts.founder_goal` and by one prompt line, and — before 2026-08-11 —
`baselinePriorities` never read it at all, so on the deterministic path it did
nothing whatsoever. Adding two more context fields would have fed the same weak
mechanism. Making the existing field bite came first: `baselinePriorities` now
applies a goal-theme bonus to candidate ranking, which is the only place `goal`
reaches the deterministic path. Re-evaluate these fields against *that* baseline,
not the old one.

**Staleness is the real risk.** Self-declared `stage` rots silently: a founder
who taps "Building" and launches two months later gets confidently mis-staged
advice indefinitely, and the model will lean on it. Stale declared state is
worse than absent state. Either re-prompt periodically, or infer stage from
which integrations are connected plus whether Stripe shows revenue — which is
free and never goes stale.

**Security, when this lands.** `description` is attacker-controlled free text in
a public multi-tenant product, flowing into an LLM instruction. The
prompt-injection clause in `generate.ts` currently names only PR titles and
`founder_goal` and must be extended to cover it. The chat route
(`app/api/chat/route.ts`) selects only `goal` today; if `description` is added
to that context too, its own injection clause needs the same treatment. Cap the
field length in the Zod schema, as `goal` already is at 200.

#### Stripe App — scoped 2026-08-12, deliberately deferred

**What shipped instead.** The connector work of 2026-08-12 made Stripe read-only
by *enforcement*: `app/api/integrations/stripe/route.ts` now rejects `sk_`
outright, so a founder cannot hand over a key that could create a charge or
issue a refund even by accident. That is the security half, and it was one line.
What did not ship is the UX half — it is still a pasted key.

**Why it was deferred, and it is not a code problem.** A Stripe App has to be
registered in the Stripe dashboard and pass Stripe's review before anyone can
install it. That is weeks of external dependency on someone else's queue, so
writing the install callback first would have meant untested OAuth code sitting
in the repo with no way to exercise it.

**Shape when built.** Declare `charge_read` and `customer_read` permissions —
that is the whole point, because the consent screen then literally reads
*read-only access to charges and customers*, which is worth more than any
reassurance on the landing page. Store the app's scoped access key in
`access_token` and the account id in `config`; `lib/collectors/stripe.ts` should
need no change, since only the key differs. Keep the `rk_` paste behind "connect
manually" exactly as the Supabase manual path works.

**Verify the current key mechanics against Stripe's docs before building** —
that surface has changed more than once, and this file is not authoritative
about it.

**Do not reach for Stripe Connect instead.** It needs review too, so it buys
nothing on speed, its consent screen is broad and vague, and it is designed for
marketplaces — a read-only briefing tool is an odd fit that review may question.

### 1c. Delivery surfaces

| Feature | Notes | Effort |
|---|---|---|
| **Slack DM delivery** | Many founders live in Slack, not email. Same brief object → Block Kit renderer (the `renderBriefEmail` pattern generalizes). **Slack is a destination, not a source** — it fills no slot in `Facts`, so it never belongs in 1a. Clean OAuth, one-click install, and a Slack app-directory listing is distribution as well as delivery | M |
| **PWA / add-to-home-screen** | The 7:05am-in-bed session; manifest + icons, no native app | S |
| **Reply-to-brief → chat** | Reply to the email, the answer comes from `/api/chat` via Resend inbound webhook. Zero-friction retention loop | M |

---

## Stage 2 — Monetization (100 → 1,000 users)

**Trigger: morning-open rate ≥ 40% at 4 weeks AND users say "take my money"
(or you need them to).**
Goal: revenue without killing the free habit loop.

| Item | Notes | Effort |
|---|---|---|
| ~~Billing (Stripe Checkout + customer portal)~~ | **Shipped 2026-08-14.** Simpler split than scoped here: the *only* gate is connector count — Free 2, Founder $19/mo unlimited. Daily brief, chat and goal tracking stay free on both, because gating the habit would kill the habit. Team/Growth is a `mailto:`, not a plan. See ARCHITECTURE › The paywall: six walls | — |
| **Team briefs** | Same startup, brief goes to co-founders too; one shared integration set. First natural expansion revenue | M |
| **Investor update draft** | "Generate my monthly investor update" from 30 days of collected facts — founders dread writing these; the data is already in `daily_metrics`. Possibly the single most viral feature | M |
| **Public changelog page** | Auto-generated "what we shipped this week" page founders can share — every share is marketing | M |
| **Referral loop** | "Powered by Founder Brief" footer in shared artifacts; founders' audiences are founders | S |

### Social media (revisited from MVP)

Rejected in MVP (X API ~$100/mo, LinkedIn closed, IG/TikTok review queues) in
favor of Plausible referral sources, which answer "did my post work?" for free.
Revisit **only** when paying users ask:

| Source | Feasibility |
|---|---|
| X follower/post metrics | Paid API; one ledger row + post-spike attribution. Only at revenue |
| LinkedIn | Effectively closed for personal metrics; company pages partially open. Low priority |
| YouTube | Good API, real founder audience segment | 
| Newsletter (Substack/Beehiiv/ConvertKit) | Subscriber counts — often *more* decision-relevant than social for early founders; Beehiiv/ConvertKit have clean APIs. Do this **before** any social API |

### AI, level 2

| Item | Notes | Effort |
|---|---|---|
| **Chat with live tool-calling** | MVP chat reasons over stored 14-day facts. v2 gives it read-only tools (query metrics by range, list PRs) with the same grounding validator on outputs. Needs eval harness *first* | L |
| **"Why?" drill-downs** | Tap any ledger row → deterministic decomposition (sources for traffic, repos for commits) — not LLM speculation | M |
| **Auto-schema detection** | The magic rejected in MVP: LLM suggests the signups table mapping, founder *confirms* (never silently applied). Trust budget exists now; onboarding friction drops | M |
| **Eval suite for the brief** | Frozen fact-fixtures → assert insight quality + zero hallucinated numbers on every prompt/model change. Prerequisite for touching prompts confidently | M |

---

## Stage 3 — Scale (1,000+ users)

**Trigger: cron duration creeping toward the 300s cap, or >2k users, or the
first "my brief was late" complaint.**

### The bottleneck you hit first: the hourly cron

`/api/cron/hourly` processes users **sequentially** in one invocation
(`maxDuration: 300`). Each user = ~6–12 external API calls. Envelope math:
~1.5–3s per user → **the cron falls over somewhere between 100 and 200 users
in a single timezone hour.** This is the first real scaling fix:

1. **Now (free):** batch users with `Promise.allSettled` in groups of ~10
   inside the existing cron. Buys 5–10×. One-file change.
2. **Then (queue):** cron becomes a *dispatcher* that enqueues one job per
   user — Supabase Queues / pgmq, or Upstash QStash, or Inngest. Workers
   process per-user jobs with retries + per-job timeouts. A failed user no
   longer delays anyone else's 7am. This is the architecture end-state;
   everything else below is tuning.
3. **Per-provider token buckets:** GitHub search API is 30 req/min per token —
   at scale, stagger collection across the whole hour instead of the top of it
   (collect at :00–:50, generate at :50, send at send_hour exactly).

### Database

| Concern | When | Fix |
|---|---|---|
| `daily_metrics` growth | ~10k users × 3 sources × 365d ≈ 11M rows/yr — Postgres shrugs, but queries need the existing `(user_id, metric_date)` index. Fine to 100k+ users | Partition by month only if it ever hurts |
| Connection exhaustion | Serverless + many concurrent invocations | Use Supabase's pooled connection string (Supavisor); the JS client over HTTP already avoids most of this |
| Chat history growth | Unbounded inserts | 90-day retention job; users don't reread old chats |

### Cost control (the bill that grows silently)

| Cost | Control |
|---|---|
| OpenAI | Briefs are one small call/user/day (cheap); **chat is the risk** — per-user daily token budget, cache the morning brief context, keep `gpt-4o-mini`-class models for chat |
| Resend | Volume pricing is linear and fine; watch bounce rate → domain reputation |
| Vercel | Function duration is the driver — the queue migration (above) also caps this |
| GitHub API | One OAuth app = one rate-limit pool per *user token* (5k/hr each) — fine; search API needs the stagger fix |

### Reliability & operations

- **Idempotency is already designed in** (upserts keyed on `(user_id, date)`) — keep it sacred; it's what makes retries safe.
- **Dead-letter + retry** on per-user jobs (comes free with Inngest/QStash).
- **Status metric:** briefs generated by 8am / briefs expected. This is *the* SLO. Alert below 99%.
- **Export before deletion** — "download my briefs as JSON" before the delete
  button. A genuine GDPR nicety and the right instinct, deliberately cut so that
  deletion could ship on its own rather than waiting for it.
- **`error_events` table in our own Supabase — the step between the Stage 0 email
  alert and full observability.** Trigger: the failure email stops being useful
  because it fires often enough that you need history and grouping rather than a
  ping. Shape: `user_id`, `stage` (`collect:github`, `llm`, `email`),
  short sanitised `message`, `created_at`.

  Four things that are easy to get wrong and expensive to retrofit:
  **(1)** log a stage and a *sanitised* message, never the raw error — a `fetch`
  failure can carry the request URL, a PostgREST error can echo the query, and an
  OpenAI error can echo the request body, which contains PR titles and
  `founder_goal`. Categorise at the write, don't dump and hope.
  **(2)** `on delete cascade` on `auth.users(id)` like every other table, or
  account deletion silently stops being complete and the privacy page becomes
  inaccurate.
  **(3)** it needs a `GRANT` — a new table gets no privileges (migration `0003`),
  the same trap that made GitHub connect fail silently for a day.
  **(4)** a retention TTL (30 days is ample for triage); an error log that grows
  forever is diagnostics about users who have left.

  Also note the table alone does not alert — it moves the silence from Vercel's
  logs into our own database. It is a triage tool, not a signal.
- **The cron masks per-user failures.** `app/api/cron/hourly/route.ts` catches a
  failed user, records `"error"` in its results map, and still returns
  `{ ok: true }` with a 200 — so the GitHub Action stays green and nobody is
  told. This is *why* the Stage 0 alert exists, and it is also the smallest
  possible fix: return non-200 when a run fails outright, and GitHub emails on a
  red workflow with no extra infrastructure at all.
- **Observability:** Sentry (errors) + Axiom or Logflare (structured logs) when `console.error` stops being greppable.
- **Backups:** Supabase PITR on the Pro plan the day revenue exists.

### Security hardening at scale (from the sweep's "accepted risks")

| Item | Trigger |
|---|---|
| Upstash Redis rate limiting at the edge (per-IP + per-user) | First abuse incident or 1k users |
| CAPTCHA / Turnstile on signup | First bot-signup wave |
| Key rotation flow for `ENCRYPTION_KEY` (re-encrypt integrations) | Before SOC 2 conversations |
| Secrets manager instead of raw env vars | Team > 2 engineers |
| Pen test + SOC 2 Type I | First enterprise-ish customer asks |

---

## Stage 4 — Expansion bets (only after Stages 1–3 are boring)

Unvalidated, potentially large. Pick **one** at a time:

- **Founder Brief for accelerator batches** — YC/Techstars cohort dashboards; the batch director gets the roll-up. B2B2C distribution in one deal
- **Public "building in public" briefs** — opt-in public daily brief page; every reader is a prospect
- **Voice brief** — TTS morning audio ("listen while making coffee")
- **API / webhooks** — the brief object as a product; Zapier integration
- **Multi-startup portfolio view** — for angels and studio founders
- **Native mobile app** — only if PWA engagement data demands it; push notifications are the sole real advantage
- **Ecommerce brief (Shopify)** — deliberately *not* in 1a. Shopify has the best OAuth and app store on this list, but its founders care about AOV, refunds, inventory, ad spend and ROAS, and they bring no GitHub and no Supabase — three of the four slots in `Facts` sit permanently empty and the brief reads broken. This is a second product sharing a pipeline, not a connector. Also note the space already has funded competition (Triple Whale, Polar Analytics, Lifetimely), which the SaaS-founder segment does not
- **Mobile-app brief (RevenueCat)** — same shape of bet. Trial conversion, cohort churn and store breakdown are a different vocabulary, the stack around it is Firebase and App Store Connect rather than the current four, and RevenueCat offers API keys only, no OAuth. Fork the brief or don't bother

---

## The standing rules (carry into every stage)

1. **Every number must be true.** New sources go through the deterministic
   diff engine and the grounding validator (`numbersAreGrounded`). No
   exceptions, ever — trust is the product.
2. **"Cause unknown" stays honest.** Annotations (1b) reduce unknowns by
   adding *data*, never by letting the LLM speculate.
3. **One page, no dashboards.** Feature pressure will push toward charts and
   tabs. The moment Founder Brief needs navigation, it has lost its category.
4. **Additions must defend the 30-second read.** Anything that makes the
   morning brief longer needs to earn its lines.
5. **Ship the collector, not the platform.** Every new integration is a
   ~30-line fetch-and-store file in `lib/collectors/` — resist building an
   "integration framework" until the fifth one hurts.
