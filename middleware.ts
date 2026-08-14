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
    path.startsWith("/auth") ||
    path.startsWith("/api/cron") ||
    // The OAuth return legs from github.com and supabase.com. They must reach
    // their route handlers even if the session looks stale here, because
    // redirecting instead discards the one-time ?code= and leaks it into the
    // /login URL. Both routes still call getUser() themselves, so access is not
    // widened — and the gh_oauth_state / sb_oauth_state cookies are what
    // actually guard them against CSRF.
    path === "/api/integrations/github/callback" ||
    path === "/api/integrations/supabase/callback" ||
    // Stripe carries no session cookie, so the billing webhook cannot sit
    // behind the session gate: without this the POST is redirected to /login,
    // Stripe records the 307 as a successful delivery, and no subscription ever
    // activates. The route is not unprotected — its Stripe signature check
    // replaces the session as the authorisation boundary, which is exactly why
    // that check must never be relaxed. See app/api/billing/webhook/route.ts.
    path === "/api/billing/webhook";

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

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
