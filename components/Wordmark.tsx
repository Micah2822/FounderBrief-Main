import Link from "next/link";

// The masthead: mark + name, always a link home. `/` resolves to the landing
// page when logged out and to today's brief when logged in, so one href is
// correct everywhere and no caller needs to know which.

// The favicon mark (app/icon.svg) minus its plate — at eyebrow size a filled
// block would read as a bullet, not a logo. Drawn in currentColor, so it takes
// the theme token it sits in and inverts with light/dark for free; no second
// asset and no image swap. width/height match the CSS so a slow stylesheet
// can't flash it at its intrinsic size.
function Mark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 44 36"
      width="11"
      height="9"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
      // self-start plus the nudge pins the mark to the first line's cap height
      // when the name wraps — on a narrow screen, or with a suffix. Centring
      // would otherwise float it into the gap between the two lines.
      className={`w-[11px] shrink-0 self-start mt-[3px] ${className ?? ""}`}
    >
      <rect x="0" y="0" width="44" height="7" />
      <rect x="0" y="14.5" width="37.5" height="7" />
      <rect x="0" y="29" width="17" height="7" />
      <rect x="21.5" y="29" width="6.5" height="7" />
    </svg>
  );
}

export function Wordmark({
  suffix,
  // Off only where the masthead is part of a specimen brief rather than the
  // page's own chrome — see BriefView's `sample`.
  linked = true,
}: {
  suffix?: string;
  linked?: boolean;
}) {
  const name = `Founder Brief${suffix ? ` · ${suffix}` : ""}`;

  if (!linked) {
    return (
      <span className="inline-flex items-center gap-[7px]">
        <Mark className="text-faint" />
        <span>{name}</span>
      </span>
    );
  }

  return (
    <Link
      href="/"
      aria-label="Founder Brief — home"
      className="group inline-flex items-center gap-[7px] hover:text-ink transition-colors"
    >
      <Mark className="text-faint transition-colors group-hover:text-ink" />
      <span>{name}</span>
    </Link>
  );
}
