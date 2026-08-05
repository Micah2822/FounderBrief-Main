// Timezone-aware date helpers. "Yesterday" always means yesterday in the
// user's timezone, bounded by their local midnights, expressed in UTC.

export function localDateString(tz: string, d: Date = new Date()): string {
  // YYYY-MM-DD of `d` in timezone tz
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

export function localHour(tz: string, d: Date = new Date()): number {
  return parseInt(
    new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", hour12: false }).format(d),
    10
  );
}

/** UTC instant of local midnight for a YYYY-MM-DD in tz. */
export function localMidnightUTC(dateStr: string, tz: string): Date {
  // Start from the date at UTC midnight, then correct by the tz offset.
  const utcGuess = new Date(`${dateStr}T00:00:00Z`);
  const offsetMs = tzOffsetMs(utcGuess, tz);
  return new Date(utcGuess.getTime() - offsetMs);
}

function tzOffsetMs(at: Date, tz: string): number {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(at).map((p) => [p.type, p.value]));
  const asUTC = Date.UTC(
    +parts.year, +parts.month - 1, +parts.day,
    parts.hour === "24" ? 0 : +parts.hour, +parts.minute, +parts.second
  );
  return asUTC - at.getTime();
}

export function addDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** [fromUTC, toUTC) covering local day `dateStr` in tz. */
export function dayRangeUTC(dateStr: string, tz: string): { from: Date; to: Date } {
  return {
    from: localMidnightUTC(dateStr, tz),
    to: localMidnightUTC(addDays(dateStr, 1), tz),
  };
}

export function weekday(dateStr: string): string {
  return new Intl.DateTimeFormat("en-US", { weekday: "long", timeZone: "UTC" }).format(
    new Date(`${dateStr}T12:00:00Z`)
  );
}

export function formatBriefDate(dateStr: string): string {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "UTC",
  }).format(new Date(`${dateStr}T12:00:00Z`));
}
