"use client";

import mixpanel from "mixpanel-browser";

/**
 * Mixpanel, gated on consent and configured to keep the promises the privacy
 * page makes.
 *
 * Three configuration choices here are not defaults, and each one exists to
 * avoid contradicting something we tell users on /privacy:
 *
 *   `persistence: "localStorage"` — Mixpanel's default is a cookie
 *     (`mp_<token>_mixpanel`), and cookies are sent to our own server on every
 *     request. That would put an analytics identifier in Vercel's request logs
 *     on every page load and every API call, for every visitor, including ones
 *     who declined — data we never asked for and have no use for. On
 *     localStorage the id stays in the browser and goes only to Mixpanel.
 *     Note this buys no exemption from consent: EU rules cover storing
 *     anything on someone's device, not just cookies, which is why the banner
 *     gates it either way.
 *
 *   `ip: false` — suppresses server-side geolocation from the request IP.
 *     We do not need city-level geo to answer "did this founder get a brief",
 *     and an IP is personal data in the EU whether or not we look at it.
 *
 *   `autocapture: false` — every event in this file is one we chose and can
 *     name. Autocapture would send click and pageview data we never reviewed,
 *     which is the opposite of the data minimisation the consent gate is for.
 *
 * The gate itself is `opt_out_tracking_by_default`. init() is safe to call
 * before consent — the SDK queues nothing and sends nothing while opted out —
 * so we initialise on mount and flip the switch in `grantConsent()`. Deferring
 * init() instead would mean every call site has to null-check the SDK.
 */

const TOKEN = process.env.NEXT_PUBLIC_MIXPANEL_TOKEN;

/** Where the user's own choice lives. Not a cookie — see the note above. */
export const CONSENT_KEY = "fb_analytics_consent";

export type Consent = "granted" | "denied";

let started = false;

/** Absent token = analytics off, everywhere, silently. Local dev and any
 *  self-hosted copy run without it and must not throw. */
export function analyticsEnabled(): boolean {
  return typeof window !== "undefined" && !!TOKEN;
}

export function readConsent(): Consent | null {
  if (typeof window === "undefined") return null;
  try {
    const v = window.localStorage.getItem(CONSENT_KEY);
    return v === "granted" || v === "denied" ? v : null;
  } catch {
    // Safari private mode throws on localStorage. No stored choice means the
    // banner shows again, which is the harmless direction to fail in.
    return null;
  }
}

function persistConsent(value: Consent) {
  try {
    window.localStorage.setItem(CONSENT_KEY, value);
  } catch {
    /* see readConsent */
  }
}

/** Idempotent — mounting the provider twice in dev StrictMode must not
 *  produce two instances. */
export function initAnalytics() {
  if (started || !analyticsEnabled()) return;
  started = true;

  mixpanel.init(TOKEN!, {
    // The FndrBrief project has EU data residency, and EU projects ingest at
    // api-eu.mixpanel.com. The SDK's default is the US host, which accepts
    // the request and answers `{"error":null,"status":1}` — the edge does not
    // check residency — and the events then never appear in the project. A
    // silent, well-formed success that goes nowhere, so it cannot be caught by
    // checking for errors. If this ever moves back to a US project, this line
    // and the CSP `connect-src` entry in next.config.mjs must change together.
    api_host: "https://api-eu.mixpanel.com",
    persistence: "localStorage",
    opt_out_tracking_by_default: true,
    opt_out_tracking_persistence_type: "localStorage",
    ip: false,
    autocapture: false,
    track_pageview: false,
    record_sessions_percent: 0,
    debug: process.env.NODE_ENV !== "production",
  });

  // A choice made in an earlier session is re-applied here. Without this the
  // opt-out default would silently win on every page load.
  if (readConsent() === "granted") mixpanel.opt_in_tracking();
}

export function grantConsent() {
  persistConsent("granted");
  if (!analyticsEnabled()) return;
  initAnalytics();
  mixpanel.opt_in_tracking();
}

export function denyConsent() {
  persistConsent("denied");
  if (!analyticsEnabled()) return;
  initAnalytics();
  mixpanel.opt_out_tracking();
}

/**
 * Every track call in the app goes through here. `mixpanel.track` is already
 * a no-op while opted out, but this also covers the no-token case, and gives
 * one place to add a property to every event later.
 */
export function track(event: string, properties?: Record<string, unknown>) {
  if (!started || !analyticsEnabled()) return;
  mixpanel.track(event, { platform: "web", ...properties });
}

/**
 * Called on sign-in and on session restore. The id is the Supabase auth uuid —
 * stable, internal, and never the email, which changes and is PII in a field
 * that ends up in every event.
 */
export function identifyUser(userId: string, email?: string) {
  if (!started || !analyticsEnabled()) return;
  mixpanel.identify(userId);
  // Profile properties, not event properties. $email is here so a founder who
  // emails support can be found; drop this line if you would rather Mixpanel
  // never held an address.
  mixpanel.people.set({ ...(email ? { $email: email } : {}) });
}

/** On sign-out. Skipping this merges the next person on a shared machine into
 *  the previous founder's profile. */
export function resetUser() {
  if (!started || !analyticsEnabled()) return;
  mixpanel.reset();
}

/**
 * The Value Moment: a brief actually reached the founder.
 *
 * Fired on the client, from the four buttons that ask for one, rather than
 * server-side in /api/brief/generate — which would be the tidier single
 * choke point but would sail straight past the consent gate, since the server
 * has no idea what the user chose in the banner. The cron path that mails
 * briefs overnight is deliberately not tracked for the same reason: nobody is
 * present to have consented.
 *
 * `source` is what separates the founder who came back and pressed Refresh
 * from the one who only ever saw the brief onboarding made for them.
 */
export function trackBriefGenerated(source: string, brief?: { brief_date?: string }) {
  track("brief_generated", {
    source,
    ...(brief?.brief_date ? { brief_date: brief.brief_date } : {}),
  });
}
