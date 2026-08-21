# Analytics Tracking — Mixpanel

This project uses **Mixpanel** for all product analytics. Mixpanel is the single
source of truth for event tracking, user identification, and behavioural data.
Do not introduce any other analytics tool, SDK, or tracking library without
explicit instruction from a user.

> **Not to be confused with the Plausible connector.** `lib/collectors/plausible.ts`
> and the `plausible` integration provider are a *customer data source* — a
> founder pastes their own Plausible key so their site traffic appears in their
> brief. That is not our analytics. Mixpanel is.

---

## Before You Add or Modify Any Tracking

⛔ **Do not write Mixpanel tracking code without reading this file first.**

- [ ] Use `lib/analytics.ts` — never import `mixpanel-browser` anywhere else
- [ ] There is no CDP; events go straight from the browser to Mixpanel
- [ ] **Consent gating is mandatory.** This product has EU and California users.
      No event may fire before the founder accepts the banner
- [ ] Review the tracking plan below before adding an event
- [ ] Server-side tracking is **not** wired up, and adding it needs a decision
      first — see "Why everything is client-side" below

---

## Tech Stack

| Detail | Value |
|---|---|
| **Platform** | Next.js 14 (App Router), React 18, TypeScript — web only |
| **Mixpanel SDK** | `mixpanel-browser` |
| **SDK version** | `^2.82.1` |
| **Tracking method** | Client-side |
| **CDP** | none |
| **Consent required** | **Yes** — EU/EEA/UK and California users |
| **Token location** | `.env` → `NEXT_PUBLIC_MIXPANEL_TOKEN` (public write-only token) |

An absent token disables analytics everywhere, silently. Local development and
any self-hosted copy run that way and must never throw because of it.

---

## Initialization

**File:** `lib/analytics.ts` — the only file that may import `mixpanel-browser`.
**Mounted by:** `components/Analytics.tsx`, rendered once in `app/layout.tsx`.

`initAnalytics()` runs on mount with `opt_out_tracking_by_default: true`, so the
SDK is live but silent until `grantConsent()` is called. Initialising early and
gating with the opt-out flag — rather than deferring `init()` until consent —
is deliberate: it means no call site has to null-check the SDK.

Three non-default options exist to keep promises made on `/privacy`. **Do not
change them without changing that page too:**

| Option | Why |
|---|---|
| `persistence: "localStorage"` | Cookies are sent to our server on every request, putting the analytics id in Vercel logs. localStorage stays in the browser |
| `ip: false` | Suppresses geolocation from the request IP; an IP is personal data in the EU |
| `autocapture: false` | Every event is one we chose and can name; no unreviewed click/pageview data |

---

## Identity

Driven by Supabase `onAuthStateChange` in `components/Analytics.tsx` — **not** by
the sign-in and sign-out handlers.

That is on purpose. Sign-in also happens through `app/auth/callback/route.ts`, a
server redirect where no client code of ours runs, and sign-out is a plain form
POST to `app/auth/signout/route.ts` that ends in a redirect. Neither has a place
to hang an `identify()` or `reset()` call. The auth listener sees both, plus the
returning visitor whose session is restored from storage with no event of its own.

| Action | When | Where |
|---|---|---|
| `identifyUser(id, email)` | Any session present — sign-in, restore, refresh | `components/Analytics.tsx` |
| `identifyUser(id, email)` | Immediately after OTP verify, so `sign_up_completed` is attributed | `app/login/page.tsx` |
| `resetUser()` | `SIGNED_OUT` | `components/Analytics.tsx` |

**Rules:**

- The distinct_id is the **Supabase auth uuid** — never the email. Email changes,
  and it is PII that would otherwise land in every event
- Email is set once as a `$email` *profile* property, never as an event property
- Never `identify()` a second user without `reset()` first

---

## Tracking Plan

### Naming conventions

- Events: `snake_case`, past tense verb + noun (`brief_generated`)
- Properties: `snake_case`, no abbreviations
- Booleans: `is_` prefix
- `platform: "web"` is attached to every event by `track()` — do not pass it again

### Current events

| Event | Trigger | Properties | File |
|---|---|---|---|
| `sign_up_completed` | First-ever OTP verify succeeds | `sign_up_method`, `platform` | `app/login/page.tsx` |
| `brief_generated` | **Value Moment.** A brief is returned to the founder | `source`, `brief_date`, `platform` | `components/{GenerateButton,RefreshBrief,TodayBrief,OnboardingFlow}.tsx` via `trackBriefGenerated()` |

`source` values: `generate_button`, `refresh`, `today_so_far`, `onboarding`.

**Distinguishing sign-up from sign-in:** one OTP flow serves both, and Supabase
gives no "new user" flag. `app/login/page.tsx` tells them apart by comparing
`user.created_at` to now with a 60-second window. If you touch that, keep the
comment explaining why the window is that width.

### Why everything is client-side

`brief_generated` fires from the four buttons, not from `app/api/brief/generate/route.ts`
— which would be the tidier single choke point. The route runs on the server,
which has no idea what the founder chose in the consent banner, so tracking there
would sail straight past the gate.

For the same reason the **cron path is deliberately untracked**: `app/api/cron/hourly/route.ts`
generates overnight briefs with nobody present to have consented. Briefs
generated by cron therefore do not appear in Mixpanel. This is a known and
accepted gap — if you need that number, get it from the database, or add
server-side tracking only after deciding how consent is honoured there.

---

## How to Add a New Event

1. Check the table above — reuse before creating
2. Name it `snake_case`, past tense
3. Import `track` from `lib/analytics.ts`; only include properties available at
   fire time — never fetch extra data just to track
4. Fire **after** the action succeeds (after the API responds), not on click
5. Add it to the table above
6. Confirm it in Mixpanel Live View before calling it done
7. If it changes what data leaves the browser, **update `app/privacy/page.tsx`**

```ts
import { track } from "@/lib/analytics";
track("connector_connected", { provider: "github" });
```

---

## What Not to Do

- **Do not import `mixpanel-browser` outside `lib/analytics.ts`**
- **Do not add another analytics tool**
- **Do not track PII as event properties** — no emails, names, or IPs
- **Do not track anything drawn from a founder's brief or connected accounts.**
  `/privacy` states plainly that we never do. Commit subjects, PR titles, repo
  names, revenue figures and traffic numbers are all off limits
- **Do not track page views or clicks** — events are actions, not navigation
- **Do not hardcode the token** — it comes from `NEXT_PUBLIC_MIXPANEL_TOKEN`
- **Do not skip `reset()` on logout** — the next person on a shared machine
  would merge into the previous founder's profile
- **Do not widen the CSP for Mixpanel.** `next.config.mjs` allows exactly one
  host, `https://api-js.mixpanel.com`, in `connect-src`. The SDK is bundled from
  npm, so `cdn.mxpnl.com` is not needed in `script-src` and must not be added.
  Session recording and some Mixpanel add-ons would require widening it — treat
  that as a decision for a human, not a fix
