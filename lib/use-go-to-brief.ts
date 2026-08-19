"use client";

import { useRouter } from "next/navigation";

/**
 * Show the result of a brief generation in exactly one server round trip.
 *
 * Three buttons — Refresh, "Today so far", and the last step of onboarding —
 * all end the same way: POST to /api/brief/generate, then display what came
 * back. Each used to do this:
 *
 *     if (date) router.push(`/?date=${date}`);
 *     router.refresh();
 *
 * which renders the page on the server **twice**. `push` navigates, and
 * `refresh` then throws that away and re-fetches the same route. On the home
 * page that is the entire settings/brief/archive fetch run start to finish,
 * twice, back to back — the slowest interaction in the product, doubled.
 *
 * The second call cannot simply be deleted, and that is the trap: when the
 * founder is already on `/?date=2026-08-14` and refreshes *that* day, `push`
 * targets the URL they are on and the App Router may answer it from its
 * client-side cache — so the freshly generated brief never appears and the
 * button looks broken. `refresh()` was quietly covering that.
 *
 * Hence: navigate when the URL actually changes, refresh when it does not.
 * One render either way, and neither path can serve a stale brief.
 *
 * `target` of `null` means "stay here and re-read" — which is what the
 * generation buttons want when the response carries no date, and is not the
 * same as onboarding's "/" (go to the newest brief). Passing the path in
 * rather than the date keeps that distinction at the call site, where the
 * three buttons genuinely disagree.
 */
export function useGoToBrief() {
  const router = useRouter();

  return function goToBrief(target: string | null) {
    if (target === null) {
      router.refresh();
      return;
    }
    const current = `${window.location.pathname}${window.location.search}`;
    if (target === current) router.refresh();
    else router.push(target);
  };
}
