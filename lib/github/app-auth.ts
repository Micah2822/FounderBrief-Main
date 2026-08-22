import { createSign, randomBytes } from "crypto";

// GitHub App authentication.
//
// The app proves itself with a short-lived RS256 JWT signed by its private key,
// then trades that for an *installation* token scoped to one user's selected
// repositories. Nothing here is stored: `integrations.access_token` stays null
// for GitHub, and the only thing in the row is an installation_id, which is not
// a secret. A database leak therefore exposes no GitHub access at all.
//
// This replaced an OAuth App with the `repo` scope. GitHub offers no read-only
// scope for private repositories on OAuth Apps — `repo` is read *and write* on
// everything — so fine-grained read-only permissions are only reachable this
// way. Don't migrate back.

const GH = "https://api.github.com";

function appId(): string {
  const id = process.env.GITHUB_APP_ID;
  if (!id) throw new Error("GITHUB_APP_ID is not set");
  return id;
}

/**
 * The OAuth client pair, used only to identify *who* is finishing an install.
 *
 * Separate from the App ID and private key above, which authenticate the app
 * itself. These two answer a different question — not "is this Founder Brief"
 * but "is this person the one who owns this installation" — and there is no way
 * to answer it from app credentials alone, because GitHub hands the callback an
 * installation_id and nothing about the human who clicked.
 */
function clientId(): string {
  const id = process.env.GITHUB_APP_CLIENT_ID;
  if (!id) throw new Error("GITHUB_APP_CLIENT_ID is not set");
  return id;
}

function clientSecret(): string {
  const secret = process.env.GITHUB_APP_CLIENT_SECRET;
  if (!secret) throw new Error("GITHUB_APP_CLIENT_SECRET is not set");
  return secret;
}

/**
 * The PEM GitHub hands you is multi-line. Some env-var UIs keep the newlines and
 * some require them escaped, so `\n` is unescaped here; both paste cleanly.
 */
function privateKey(): string {
  const raw = process.env.GITHUB_APP_PRIVATE_KEY;
  if (!raw) throw new Error("GITHUB_APP_PRIVATE_KEY is not set");
  if (!raw.includes("-----BEGIN")) {
    throw new Error("GITHUB_APP_PRIVATE_KEY is not a PEM private key");
  }
  // Checking the footer separately is worth the extra line: dotenv only keeps a
  // multi-line value if it was quoted, so an unquoted PEM arrives as just its
  // -----BEGIN line. That passes a header-only check and then dies inside
  // createSign with a generic OpenSSL error that says nothing about the cause.
  if (!raw.includes("-----END")) {
    throw new Error(
      "GITHUB_APP_PRIVATE_KEY is truncated — a multi-line PEM must be wrapped in " +
        'double quotes, or written on one line with literal \\n between lines'
    );
  }
  return raw.replace(/\\n/g, "\n");
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/**
 * App-level JWT. Good for 10 minutes; GitHub rejects anything longer. `iat` is
 * backdated 60s because GitHub compares against its own clock and a fast server
 * can otherwise issue a token that is briefly "in the future".
 */
function appJwt(): string {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = b64url(JSON.stringify({ iat: now - 60, exp: now + 540, iss: appId() }));
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${payload}`);
  return `${header}.${payload}.${b64url(signer.sign(privateKey()))}`;
}

// Installation tokens last an hour. Cache them so a single request or cron pass
// mints once rather than per collector call.
const cache = new Map<string, { token: string; expiresAt: number }>();

/** Mint (or reuse) an installation token for one user's GitHub App install. */
export async function getInstallationToken(installationId: string | number): Promise<string> {
  const id = String(installationId);
  const hit = cache.get(id);
  // 60s of headroom so a token can't expire mid-collection.
  if (hit && hit.expiresAt > Date.now() + 60_000) return hit.token;

  const res = await fetch(`${GH}/app/installations/${id}/access_tokens`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${appJwt()}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    cache: "no-store",
  });

  if (!res.ok) {
    // 404 here almost always means the user uninstalled the app rather than
    // anything being wrong with our credentials.
    const detail = res.status === 404 ? "installation not found (uninstalled?)" : await res.text();
    throw new Error(`GitHub installation token failed (${res.status}): ${detail}`);
  }

  const body = (await res.json()) as { token: string; expires_at: string };
  cache.set(id, { token: body.token, expiresAt: new Date(body.expires_at).getTime() });
  return body.token;
}

/** Where we send the user to install the app onto their repositories. */
export function installUrl(state: string): string {
  const slug = process.env.GITHUB_APP_SLUG;
  if (!slug) throw new Error("GITHUB_APP_SLUG is not set");
  const url = new URL(`https://github.com/apps/${slug}/installations/new`);
  url.searchParams.set("state", state);
  return url.toString();
}

export function newState(): string {
  return randomBytes(16).toString("hex");
}

/**
 * Trade the `code` GitHub puts on the callback for a short-lived *user* token.
 *
 * Requires "Request user authorization (OAuth) during installation" on the App.
 * With it off there is no `code`, the callback has nothing to verify against,
 * and installs fall back to trusting whoever holds the state cookie — which is
 * the hole this exists to close.
 *
 * The token is deliberately never returned to a caller that stores it. It is
 * used once, in the callback, to answer one question, and then dropped: nothing
 * about it reaches the database, so `integrations.access_token` stays null for
 * GitHub and a database leak still exposes no GitHub access at all.
 */
export async function exchangeUserCode(code: string): Promise<string> {
  const res = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ client_id: clientId(), client_secret: clientSecret(), code }),
    cache: "no-store",
  });

  if (!res.ok) throw new Error(`GitHub code exchange failed (${res.status})`);

  // GitHub answers 200 with an `error` field rather than an HTTP error status
  // when the code is expired or already redeemed — so checking res.ok alone
  // would sail past the most common failure and hand back `undefined`.
  const body = (await res.json()) as { access_token?: string; error?: string };
  if (body.error) throw new Error(`GitHub code exchange failed: ${body.error}`);
  if (!body.access_token) throw new Error("GitHub code exchange returned no token");
  return body.access_token;
}

/**
 * Does this GitHub user actually have access to this installation?
 *
 * The one check that makes the callback safe. Without it, an installation_id is
 * an unauthenticated claim: tokens are minted from *our* app key, so any signed-in
 * account that names someone else's installation is handed their repositories.
 * A state cookie cannot close that — an attacker starts a real flow in their own
 * browser and gets a valid one, then swaps the id.
 *
 * `/user/installations` is scoped to the token's owner, so this cannot be forged
 * without the victim's own GitHub session.
 *
 * Note this is deliberately *not* an ownership test on the GitHub account: a
 * member of an org can see the org's installation, which is correct. Two
 * colleagues at the same company should both be able to connect it.
 */
export async function userOwnsInstallation(
  userToken: string,
  installationId: string | number
): Promise<boolean> {
  const want = Number(installationId);
  if (!Number.isFinite(want)) return false;

  // Paginated: someone in many orgs can exceed a single page, and stopping at
  // page one would reject a legitimate install for looking absent.
  for (let page = 1; page <= 10; page++) {
    const res = await fetch(`${GH}/user/installations?per_page=100&page=${page}`, {
      headers: {
        Authorization: `Bearer ${userToken}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`GitHub /user/installations failed (${res.status})`);

    const body = (await res.json()) as { installations?: { id: number }[] };
    const list = body.installations ?? [];
    if (list.some((i) => i.id === want)) return true;
    // Short page means last page; anything else would loop for no reason.
    if (list.length < 100) return false;
  }
  return false;
}
