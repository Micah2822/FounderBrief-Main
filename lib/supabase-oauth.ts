import { createHash, randomBytes } from "crypto";

// OAuth against the Supabase **Management API** — this is the FOUNDER's own
// Supabase account (their product's database), not the app's project. For the
// app's own Supabase clients see lib/supabase/{admin,server,client}.ts.
//
// The management token issued here is deliberately short-lived in our hands: it
// can read API keys for every project in the user's organization, which is far
// more authority than the brief needs. So it is never written to the database —
// it lives in an encrypted, httpOnly, 10-minute cookie, is used to fetch one
// project's key, and is dropped. What we keep is exactly what the manual paste
// flow would have stored: a single project's key.
//
// Consequence worth knowing: we cannot silently re-fetch a key in the
// background if the user rotates it. That is intentional — reconnecting is one
// click, and it is the price of not holding org-wide access indefinitely.

const API = "https://api.supabase.com";

/** Name of the httpOnly cookie holding the encrypted management token. */
export const TOKEN_COOKIE = "sb_mgmt_token";

/** Cookies cap at ~4KB; refuse to write one that would be silently truncated. */
export const MAX_COOKIE_BYTES = 3800;

export function clientId(): string {
  const id = process.env.SUPABASE_OAUTH_CLIENT_ID;
  if (!id) throw new Error("SUPABASE_OAUTH_CLIENT_ID is not set");
  return id;
}

function clientSecret(): string {
  const secret = process.env.SUPABASE_OAUTH_CLIENT_SECRET;
  if (!secret) throw new Error("SUPABASE_OAUTH_CLIENT_SECRET is not set");
  return secret;
}

export function redirectUri(appUrl: string): string {
  return `${appUrl.replace(/\/$/, "")}/api/integrations/supabase/callback`;
}

function b64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// ── PKCE ──────────────────────────────────────────────────────────────

export function newVerifier(): string {
  return b64url(randomBytes(48)); // 64 chars, inside PKCE's 43–128 range
}

export function challengeFor(verifier: string): string {
  return b64url(createHash("sha256").update(verifier).digest());
}

export function authorizeUrl(opts: {
  appUrl: string;
  state: string;
  verifier: string;
}): string {
  const url = new URL(`${API}/v1/oauth/authorize`);
  url.searchParams.set("client_id", clientId());
  url.searchParams.set("redirect_uri", redirectUri(opts.appUrl));
  url.searchParams.set("response_type", "code");
  url.searchParams.set("state", opts.state);
  url.searchParams.set("code_challenge", challengeFor(opts.verifier));
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

// ── Management API ────────────────────────────────────────────────────

export async function exchangeCode(opts: {
  code: string;
  verifier: string;
  appUrl: string;
}): Promise<string> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: opts.code,
    redirect_uri: redirectUri(opts.appUrl),
    code_verifier: opts.verifier,
  });
  const basic = Buffer.from(`${clientId()}:${clientSecret()}`).toString("base64");
  const res = await fetch(`${API}/v1/oauth/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Supabase token exchange failed (${res.status})`);
  const json = (await res.json()) as { access_token?: string };
  if (!json.access_token) throw new Error("Supabase returned no access token");
  // The refresh token in this response is deliberately dropped — see the note
  // at the top of this file. Persisting it is what we are avoiding.
  return json.access_token;
}

export type ManagedProject = { ref: string; name: string };

export async function listProjects(token: string): Promise<ManagedProject[]> {
  const res = await fetch(`${API}/v1/projects`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Could not list Supabase projects (${res.status})`);
  const projects = (await res.json()) as any[];
  return (projects ?? [])
    .filter((p) => p?.id)
    .map((p) => ({ ref: String(p.id), name: String(p.name ?? p.id) }));
}

export function projectUrl(ref: string): string {
  return `https://${ref}.supabase.co`;
}

/**
 * The project's service key — the same credential the manual flow asks users to
 * paste, fetched on their behalf. It is used server-side only and never sent to
 * the browser.
 */
export async function getProjectServiceKey(token: string, ref: string): Promise<string> {
  const url = new URL(`${API}/v1/projects/${ref}/api-keys`);
  url.searchParams.set("reveal", "true"); // newer API hides values without this
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Could not read API keys for that project (${res.status})`);

  const keys = (await res.json()) as any[];
  const value = (k: any) => k?.api_key ?? k?.apiKey ?? k?.value;
  const named = (want: string) =>
    (keys ?? []).find((k) => (k?.name ?? k?.type) === want && value(k));

  // Row counts must see every row, so RLS has to be bypassed — the anon key
  // would silently return zero on any table with a policy.
  const chosen = named("service_role") ?? named("secret");
  const key = chosen && value(chosen);
  if (!key) throw new Error("That project has no readable service key");
  return String(key);
}
