import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  // Auth cookies refreshed during this request, kept so they can be replayed
  // onto whatever response we finally return. Supabase rotates refresh tokens:
  // if a refresh happens and we then return a response that doesn't carry the
  // new cookies, the old token is already dead server-side and the browser is
  // silently signed out.
  let refreshed: { name: string; value: string; options: CookieOptions }[] = [];

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
          refreshed = cookiesToSet;
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // Refresh the session if expired — required for Server Components.
  //
  // `getUser()` is a network call to Supabase Auth on every request that
  // reaches here, not a local token decode. That is the reason `/api` is
  // excluded at the matcher below rather than being listed as public: an API
  // call used to pay for this hop *and* the identical one the route handler
  // makes for itself.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  const isPublic =
    path === "/" ||
    path === "/login" ||
    path === "/preview" ||
    path === "/privacy" ||
    path === "/terms" ||
    // /auth/callback must reach its handler to exchange the one-time ?code=;
    // redirecting instead discards it and leaks it into the /login URL.
    path.startsWith("/auth");

  if (!user && !isPublic && !path.startsWith("/_next")) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    const redirect = NextResponse.redirect(url);
    refreshed.forEach(({ name, value, options }) =>
      redirect.cookies.set(name, value, options)
    );
    return redirect;
  }

  return response;
}

/**
 * `api` is excluded, and that is a deliberate change of boundary rather than a
 * relaxation.
 *
 * All eighteen route handlers under /api already authenticate themselves —
 * sixteen with their own `getUser()`, plus `CRON_SECRET` on the cron and the
 * Stripe signature on the billing webhook. Middleware was therefore making a
 * second, redundant network round trip to Supabase Auth on every API call and
 * enforcing nothing that the route did not enforce again a moment later.
 *
 * Two things improve by dropping it, beyond the latency:
 *
 *  - An unauthenticated API call now gets the route's own `401 {"error":…}`
 *    instead of a `307` to /login. A redirect was always the wrong answer to
 *    `fetch()`, which follows it and then chokes parsing an HTML sign-in page.
 *  - The OAuth callbacks and the Stripe webhook no longer need naming here as
 *    exceptions. They were only ever listed because the session gate would
 *    otherwise have eaten a one-time `?code=` or a signed POST; each documents
 *    its real authorisation boundary in its own file.
 *
 * The invariant this rests on: **every route under /api authenticates itself.**
 * A new one that does not is public to the internet. There is no longer a
 * blanket session check standing behind it.
 */
export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
