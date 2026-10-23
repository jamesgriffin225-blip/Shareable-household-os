export type CalendarView = "days" | "month";

/**
 * The window the day strip opens on.
 *
 * Not a calendar week. A wall in a kitchen is asked "what is on today, and
 * what is coming" far more often than "what did Monday look like", and a
 * Monday-to-Sunday grid spends its last two columns on the past every Saturday
 * and its first five on the past every Sunday. Two days back is enough to
 * answer "was that yesterday?"; the rest of the room goes forwards.
 */
export const DAYS_BEHIND = 2;
export const DAYS_AHEAD = 4;

/**
 * How much is rendered either side, for scrolling into.
 *
 * The strip holds more than it shows so that scrolling is instant and does not
 * re-ask Google on every swipe. Beyond this, the month view is the better
 * tool, and saying so is more honest than an infinite strip that fetches
 * forever.
 */
export const SCROLL_BEHIND = 14;
export const SCROLL_AHEAD = 28;

/** How many columns are visible at once: the window, inclusive of today. */
export const VISIBLE_DAYS = DAYS_BEHIND + DAYS_AHEAD + 1;

/**
 * Ranges for the calendar, computed on `YYYY-MM-DD` day-keys.
 *
 * Deliberately not on `Date` instants. "The week containing the 8th" is a
 * question about a calendar, not about a moment, and doing it in instants means
 * every function has to be handed a timezone and every one of them is a chance
 * to be a day out. A key goes in, a key comes out; the only place a timezone is
 * needed is deciding what today's key is, which the caller does once.
 */

const KEY = /^(\d{4})-(\d{2})-(\d{2})$/;

function parse(key: string): Date {
  const match = KEY.exec(key);
  if (!match) throw new Error(`Not a day key: ${key}`);
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
}

function format(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function addDayKeys(key: string, days: number): string {
  const date = parse(key);
  date.setUTCDate(date.getUTCDate() + days);
  return format(date);
}

export function addMonthKeys(key: string, months: number): string {
  const date = parse(key);
  const day = date.getUTCDate();
  // Snap to the 1st before shifting, or 31 March minus one month lands in
  // March again by way of a 31st of February.
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + months);
  const lastOfMonth = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0),
  ).getUTCDate();
  date.setUTCDate(Math.min(day, lastOfMonth));
  return format(date);
}

/** Monday of the week containing `key`. */
export function startOfWeekKey(key: string): string {
  const date = parse(key);
  const back = (date.getUTCDay() + 6) % 7;
  return addDayKeys(key, -back);
}

export function startOfMonthKey(key: string): string {
  return `${key.slice(0, 7)}-01`;
}

export function endOfMonthKey(key: string): string {
  const date = parse(key);
  return format(new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)));
}

export interface DayRange {
  /** First day shown, inclusive. */
  from: string;
  /** Last day shown, inclusive. */
  to: string;
}

/**
 * The days a view covers.
 *
 * A month view is a grid of whole weeks, so it reaches back into the previous
 * month and forward into the next — and those days have to be fetched, or the
 * last week of August is blank every September.
 */
export function viewRange(view: CalendarView, anchor: string): DayRange {
  if (view === "days") {
    // What is fetched and rendered, which is wider than what is on screen.
    return {
      from: addDayKeys(anchor, -SCROLL_BEHIND),
      to: addDayKeys(anchor, SCROLL_AHEAD),
    };
  }
  const from = startOfWeekKey(startOfMonthKey(anchor));
  const lastRow = startOfWeekKey(endOfMonthKey(anchor));
  return { from, to: addDayKeys(lastRow, 6) };
}

/** The days actually on screen when the strip is scrolled to `first`. */
export function visibleRange(first: string): DayRange {
  return { from: first, to: addDayKeys(first, VISIBLE_DAYS - 1) };
}

/** Where the strip sits when it opens, and when Today is pressed. */
export function openingDay(todayKey: string): string {
  return addDayKeys(todayKey, -DAYS_BEHIND);
}

export function dayKeysIn({ from, to }: DayRange): string[] {
  const keys: string[] = [];
  for (let key = from; key <= to; key = addDayKeys(key, 1)) keys.push(key);
  return keys;
}

/** One step forwards or backwards, in whatever unit the view is made of. */
export function shiftAnchor(
  view: CalendarView,
  anchor: string,
  delta: number,
): string {
  return view === "days"
    ? addDayKeys(anchor, delta * VISIBLE_DAYS)
    : addMonthKeys(anchor, delta);
}

/**
 * A period the money tile pages through.
 *
 * Deliberately its own type. It used to borrow `CalendarView`, which was fine
 * while that happened to read "week" | "month" -- and became a compile error
 * the moment the calendar stopped being a week. They were never the same idea:
 * one is how the wall displays days, the other is how far back spending is
 * added up.
 */
export type SpendPeriod = "week" | "month";

export function shiftPeriod(period: SpendPeriod, anchor: string, delta: number): string {
  return period === "week" ? addDayKeys(anchor, delta * 7) : addMonthKeys(anchor, delta);
}

/** "7 – 13 Sept", or "September 2026". */
export function periodLabel(period: SpendPeriod, anchor: string): string {
  if (period === "month") return monthLabel(anchor);
  const from = startOfWeekKey(anchor);
  return spanLabel(from, addDayKeys(from, 6));
}

function monthLabel(anchor: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "UTC",
    month: "long",
    year: "numeric",
  }).format(parse(anchor));
}

function spanLabel(from: string, to: string): string {
  const day = (key: string, withMonth: boolean) =>
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "UTC",
      day: "numeric",
      ...(withMonth ? { month: "short" as const } : {}),
      ...(from.slice(0, 4) === to.slice(0, 4) ? {} : { year: "numeric" as const }),
    }).format(parse(key));

  const sameMonth = from.slice(0, 7) === to.slice(0, 7);
  return `${day(from, !sameMonth)} – ${day(to, true)}`;
}

/**
 * What the header says: "8 – 14 Sept" or "September 2026".
 *
 * For the day strip this is the range ON SCREEN, so it has to be given the
 * leftmost visible day rather than the anchor -- the anchor names what was
 * fetched, which is four times wider.
 *
 * No timezone argument: the keys are already calendar dates, so they are read
 * back in UTC and mean exactly what they say.
 */
export function rangeLabel(view: CalendarView, anchor: string): string {
  if (view === "month") return monthLabel(anchor);
  const { from, to } = visibleRange(anchor);
  return spanLabel(from, to);
}

