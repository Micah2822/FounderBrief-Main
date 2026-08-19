/**
 * Shown while a dynamic page renders on the server.
 *
 * Every page here is `force-dynamic` and reads per-user rows, so a navigation
 * cannot be served from cache — it waits on the server. Without this file
 * Next.js has no fallback to swap in, so the *previous* page stays on screen,
 * frozen and unresponsive, until the new one is ready. Clicking Settings
 * looked like a dead button for the better part of a second.
 *
 * This is perceived performance, not real performance: it does not make the
 * render faster, it makes the click acknowledged. Both matter, and only this
 * one is free.
 *
 * No spinner and no pulse, deliberately — globals.css keeps motion to `.rise`
 * and the connector dots, and a skeleton that throbs would be the loudest
 * thing in the product. It is also not wrapped in `.rise`: that animation
 * fades in over 0.5s, which is the entire wait it exists to cover.
 *
 * The shapes mirror BriefView's masthead, ledger and insight, so the real
 * content lands in roughly the space already held rather than the page
 * jumping when it arrives.
 */
export default function Loading() {
  return (
    <main className="mx-auto max-w-[640px] px-6 py-14" aria-busy="true">
      <span className="sr-only">Loading</span>

      {/* Masthead: the dateline rule BriefView draws with border-b + py-[10px] */}
      <div className="border-b border-line py-[10px]">
        <div className="h-[11px] w-44 rounded-sm bg-line" />
      </div>

      {/* Greeting — font-serif text-[32px] with mt-10 above it */}
      <div className="mt-10 h-[38px] w-64 rounded-sm bg-line" />

      {/* Ledger. `.ledger-row` is py-[9px]; label left, figure right. */}
      <div className="mt-12">
        <div className="h-[11px] w-20 rounded-sm bg-line mb-2" />
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="ledger-row">
            <span
              className="h-[13px] rounded-sm bg-line"
              style={{ width: `${34 + ((i * 13) % 30)}%` }}
            />
            <span className="ledger-leader" aria-hidden />
            <span className="h-[13px] w-8 rounded-sm bg-line" />
          </div>
        ))}
      </div>

      {/* Main insight */}
      <div className="mt-12">
        <div className="h-[11px] w-24 rounded-sm bg-line mb-2" />
        <div className="space-y-2.5">
          <div className="h-[15px] w-full rounded-sm bg-line" />
          <div className="h-[15px] w-[93%] rounded-sm bg-line" />
          <div className="h-[15px] w-[61%] rounded-sm bg-line" />
        </div>
      </div>
    </main>
  );
}
