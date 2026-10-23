/**
 * Timezone helpers with no dependency beyond Intl.
 *
 * Claude is asked for wall-clock times ("2026-09-10T18:00") rather than
 * offsets, because a dictated "six o'clock Tuesday" has no offset in it and
 * inventing one is where calendar bugs come from. Everything here converts
 * between that wall clock and real instants using the household's timezone.
 */

// Overridden by HOUSEHOLD_TIMEZONE; this is only the fallback when it is unset.
export const DEFAULT_TIMEZONE = "Australia/Brisbane";

export function householdTimezone(): string {
  return process.env.HOUSEHOLD_TIMEZONE || DEFAULT_TIMEZONE;
}

const partsFormatter = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = partsFormatter.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    partsFormatter.set(timeZone, formatter);
  }
  return formatter;
}

/** Milliseconds that `timeZone` is ahead of UTC at the given instant. */
export function zoneOffsetMs(instant: Date, timeZone: string): number {
  const parts = formatterFor(timeZone).formatToParts(instant);
  const read = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? "0");
  // `hour: "2-digit"` with hour12:false renders midnight as 24 in some ICU
  // versions; both 0 and 24 mean the same instant here.
  const hour = read("hour") % 24;
  const asUtc = Date.UTC(
    read("year"),
    read("month") - 1,
    read("day"),
    hour,
    read("minute"),
    read("second"),
  );
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

const WALL_CLOCK =
  /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?$/;

/**
 * Turn a wall-clock string in `timeZone` into an instant.
 *
 * Accepts a bare date ("2026-09-10", treated as midnight), a wall clock
 * ("2026-09-10T18:00"), or a string that already carries an offset or Z — in
 * which case the offset wins and the timezone is ignored.
 */
export function fromWallClock(
  value: string,
  timeZone: string = householdTimezone(),
): Date | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  if (/(Z|[+-]\d{2}:?\d{2})$/.test(trimmed)) {
    const explicit = new Date(trimmed);
    return Number.isNaN(explicit.getTime()) ? null : explicit;
  }

  const match = WALL_CLOCK.exec(trimmed);
  if (!match) {
    const loose = new Date(trimmed);
    return Number.isNaN(loose.getTime()) ? null : loose;
  }

  const [, year, month, day, hour = "0", minute = "0", second = "0"] = match;
  const naive = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second),
  );

  // Guess with the offset at the naive instant, then correct once. The second
  // pass matters on the two days a year the offset changes.
  let utc = naive - zoneOffsetMs(new Date(naive), timeZone);
  const corrected = naive - zoneOffsetMs(new Date(utc), timeZone);
  if (corrected !== utc) utc = corrected;
  return new Date(utc);
}

/** True when the string names a day with no time of day in it. */
export function isDateOnly(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value.trim());
}

/** `YYYY-MM-DD` for an instant, as seen in `timeZone`. */
export function dateKey(
  instant: Date,
  timeZone: string = householdTimezone(),
): string {
  const parts = formatterFor(timeZone).formatToParts(instant);
  const read = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "00";
  return `${read("year")}-${read("month")}-${read("day")}`;
}

/** Midnight local at the start of the week containing `instant` (Monday). */
export function startOfWeek(
  instant: Date,
  timeZone: string = householdTimezone(),
): Date {
  const key = dateKey(instant, timeZone);
  const midnight = fromWallClock(key, timeZone)!;
  const weekday = new Date(
    midnight.getTime() + zoneOffsetMs(midnight, timeZone),
  ).getUTCDay();
  const back = (weekday + 6) % 7;
  return new Date(midnight.getTime() - back * 86_400_000);
}

export function addDays(instant: Date, days: number): Date {
  return new Date(instant.getTime() + days * 86_400_000);
}

/** A human sentence for a moment, in household time. Used in confirmations. */
export function describeMoment(
  value: string | Date,
  options: { allDay?: boolean; timeZone?: string } = {},
): string {
  const timeZone = options.timeZone ?? householdTimezone();
  const instant = value instanceof Date ? value : fromWallClock(value, timeZone);
  if (!instant) return typeof value === "string" ? value : "";
  const day = new Intl.DateTimeFormat("en-AU", {
    timeZone,
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(instant);
  if (options.allDay) return day;
  const time = new Intl.DateTimeFormat("en-AU", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
  }).format(instant);
  return `${day}, ${time}`;
}
