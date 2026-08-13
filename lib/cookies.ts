/**
 * Whether cookies we set should carry the `Secure` flag.
 *
 * Derived from the runtime, never from a configured URL. These flags used to
 * read `NEXT_PUBLIC_APP_URL.startsWith("https")` — and that variable was set to
 * `http://www.fndrbrief.com` in production for a period, which silently dropped
 * `Secure` from both OAuth state cookies *and* from the cookie carrying the
 * Supabase management token, a credential that can read API keys for every
 * project in the founder's organisation.
 *
 * Nothing failed visibly; the cookies simply became sendable over plaintext. A
 * security property must not be one typo in an environment variable away from
 * being off.
 *
 * Off outside production because local development is `http://localhost`, where
 * a `Secure` cookie is never sent and sign-in would break.
 */
export const SECURE_COOKIES = process.env.NODE_ENV === "production";
