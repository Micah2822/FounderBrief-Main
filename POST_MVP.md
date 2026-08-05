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
| Deploy (Supabase + Vercel + Resend + GitHub OAuth app) | The README runbook, ~15 min | XS |
| Onboard 10 founders by hand | Watch them connect; every stumble is a bug | — |
| Trust audit: verify every number in every brief for a week | One wrong number kills a user forever | S |
| Error alerting (Vercel log drains or just email on cron failure) | A silently failed 7am brief is churn you can't see | S |
| Self-serve account deletion | Privacy page currently says "email us" — make it a button | S |

**Explicitly do NOT build anything else during Stage 0.** Watch, fix, verify.

---

## Stage 1 — Retention (10 → 100 users)

**Trigger: 10 users have received briefs for 2+ weeks and you know the
morning-open rate.**
Goal: make the brief indispensable, not just pleasant.

### 1a. Data sources (widen who the brief works for)

**Prioritize by the `tool_requests` table, not by this list's order** — onboarding
captures "I use X" votes; build the top-voted source first, for named users.

| Feature | Notes | Effort |
|---|---|---|
| **Generic Postgres collector** | One connection-string integration covers Neon, Railway, Render, RDS, self-hosted — the highest-coverage single addition possible (the current "Supabase" collector is really a PostgREST client). Needs `pg` driver + read-only-role guidance | M |
| **Firebase/Firestore** | The other half of the indie-stack DB duopoly; count docs in a collection by timestamp field | M |
|---|---|---|
| ~~Stripe integration~~ | **Shipped pre-launch** (2026-07-11): gross revenue + new customers via restricted key. Still to do here: MRR (subscriptions API), churn events, failed-payment alerts | S (remainder) |
| **PostHog analytics** | Most common Plausible alternative among startups; same collector pattern (`lib/collectors/`) | S |
| **Fathom / Simple Analytics** | Same pattern; each is ~30 lines | S each |
| **Vercel Analytics** | Popular but API access is plan-gated; investigate first | M |
| **Google Analytics** | Deliberately rejected in MVP (OAuth + quota complexity). Only build when non-technical founders are a proven segment | L |
| **Linear / GitHub Issues** | "3 issues closed, 2 opened" — extends shipping beyond PRs | M |
| **Guided read-only key flow** | Wizard that generates `CREATE ROLE brief_reader ... GRANT SELECT` SQL for the founder's Supabase — removes the scariest ask in onboarding (service key) | M |

### 1b. Brief intelligence (make the insight smarter, still deterministic-first)

| Feature | Notes | Effort |
|---|---|---|
| **Weekly review (Monday edition)** | "Last week vs the week before" — the 5-minute Monday version of the daily 30-second read | M |
| **Goal tracking v2** | MVP stores one free-text goal. v2 parses a target ("100 users") and tracks it: "You said 100 users — you're at 62, +9 this week, on pace for Aug 3." The single highest-leverage retention feature in this list | M |
| **Launch/event annotations** | "I launched on PH today" → future insights can attribute spikes to *known* events without guessing. Kills the biggest "cause unknown" frustration honestly | S |
| **Anomaly memory** | Diff engine remembers baselines (best day ever, longest ship streak) → "yesterday was your best traffic day this month" becomes computable, not LLM-claimed | M |
| **More deterministic patterns** | Signup-to-visitor conversion trend, weekend-vs-weekday shape, PR review latency | S each |

### 1c. Delivery surfaces

| Feature | Notes | Effort |
|---|---|---|
| **Slack DM delivery** | Many founders live in Slack, not email. Same brief object → Block Kit renderer (the `renderBriefEmail` pattern generalizes) | M |
| **PWA / add-to-home-screen** | The 7:05am-in-bed session; manifest + icons, no native app | S |
| **Reply-to-brief → chat** | Reply to the email, the answer comes from `/api/chat` via Resend inbound webhook. Zero-friction retention loop | M |

---

## Stage 2 — Monetization (100 → 1,000 users)

**Trigger: morning-open rate ≥ 40% at 4 weeks AND users say "take my money"
(or you need them to).**
Goal: revenue without killing the free habit loop.

| Item | Notes | Effort |
|---|---|---|
| **Billing (Stripe Checkout + customer portal)** | Suggested split — Free: 1 repo + 1 data source, weekly brief. Pro (~$15–19/mo): daily brief, all integrations, chat, goal tracking. Price the *habit*, not the data | M |
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
