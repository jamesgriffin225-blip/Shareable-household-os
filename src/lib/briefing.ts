import type { CalendarEvent, Profile, ShoppingItem, Reminder } from "./types.ts";

/**
 * The household, written out for a model to read.
 *
 * A question like "when do we next have a free Saturday afternoon?" cannot be
 * answered from a list of events, because the answer is a day that is NOT in
 * the list. So every day in the window is named, including the empty ones, and
 * an empty day says so out loud. Handing over only what is booked and hoping
 * absence is noticed is the difference between an answer and a guess.
 *
 * Read-only by construction: this builds text, and the endpoint that uses it
 * cannot write anything. Asking the wall a question must never be a way to
 * change the house.
 */

/** How far ahead to describe. Two months answers "when next"; a year is noise. */
export const LOOK_AHEAD_DAYS = 56;
/** A little history, so "was that last Tuesday?" has something to work with. */
export const LOOK_BEHIND_DAYS = 7;

/**
 * A ceiling on how much calendar goes into one prompt.
 *
 * Nine weeks of a busy household is a few hundred events; this is generous for
 * that and still bounded, and the briefing says when it has cut something
 * rather than quietly answering from half the diary.
 */
const MAX_EVENTS = 400;

export interface BriefingInput {
  todayKey: string;
  timeZone: string;
  profiles: Profile[];
  events: CalendarEvent[];
  shopping: ShoppingItem[];
  reminders: Reminder[];
  /** Day keys to describe, in order. The caller owns the window. */
  days: string[];
}

function longDay(key: string): string {
  return new Intl.DateTimeFormat("en-AU", {
    timeZone: "UTC",
    weekday: "long",
    day: "numeric",
    month: "short",
  }).format(new Date(`${key}T12:00:00Z`));
}

function clock(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-AU", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}

function dayKeyOf(event: CalendarEvent, timeZone: string): string {
  return event.allDay
    ? event.start.slice(0, 10)
    : new Intl.DateTimeFormat("en-CA", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date(event.start));
}

export function formatBriefing(input: BriefingInput): string {
  const { timeZone, profiles, events, shopping, reminders, days } = input;
  const nameOf = (profileId: string) =>
    profiles.find((profile) => profile.id === profileId)?.name ?? profileId;

  const byDay = new Map<string, CalendarEvent[]>();
  for (const event of events.slice(0, MAX_EVENTS)) {
    const key = dayKeyOf(event, timeZone);
    const bucket = byDay.get(key);
    if (bucket) bucket.push(event);
    else byDay.set(key, [event]);
  }

  const lines: string[] = [];
  // The year appears here and nowhere else: a nine-week window contains only
  // one 3 January, so the day lines stay short, but the model still needs
  // anchoring to a year rather than inferring one.
  lines.push(
    `Today is ${longDay(input.todayKey)} ${input.todayKey.slice(0, 4)}. Times are ${timeZone}.`,
  );
  lines.push(
    `The household is ${profiles.map((profile) => profile.name).join(" and ")}.`,
  );
  if (events.length > MAX_EVENTS) {
    lines.push(
      `NOTE: only the first ${MAX_EVENTS} events are listed; the diary is busier than this.`,
    );
  }
  lines.push("");
  lines.push("CALENDAR");
  lines.push(
    "Every day in the window is listed. A day marked (nothing on) is genuinely free.",
  );

  for (const key of days) {
    const onThatDay = (byDay.get(key) ?? []).sort((a, b) => {
      if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
      return a.start.localeCompare(b.start);
    });
    if (onThatDay.length === 0) {
      lines.push(`${longDay(key)}: (nothing on)`);
      continue;
    }
    lines.push(`${longDay(key)}:`);
    for (const event of onThatDay) {
      const when = event.allDay
        ? "all day"
        : `${clock(event.start, timeZone)}-${clock(event.end, timeZone)}`;
      const where = event.location ? ` @ ${event.location}` : "";
      lines.push(`  ${nameOf(event.profileId)} ${when} ${event.title}${where}`);
    }
  }

  const toGet = shopping.filter((item) => !item.checkedAt);
  lines.push("");
  lines.push(
    toGet.length === 0
      ? "SHOPPING LIST: empty."
      : `SHOPPING LIST (${toGet.length}): ${toGet
          .map((item) => [item.quantity, item.name].filter(Boolean).join(" "))
          .join(", ")}.`,
  );

  const open = reminders.filter((item) => !item.doneAt);
  lines.push(
    open.length === 0
      ? "TO DO: nothing outstanding."
      : `TO DO (${open.length}): ${open
          .map((item) => (item.dueAt ? `${item.title} (due ${item.dueAt.slice(0, 10)})` : item.title))
          .join(", ")}.`,
  );

  return lines.join("\n");
}

/**
 * What the model is told about its job.
 *
 * "Say so" rather than "be helpful": the failure that matters on a kitchen
 * wall is a confident wrong answer about a Saturday that is not actually free.
 */
export const ASK_SYSTEM = [
  "You answer questions about one household's calendar, shopping list and to-do list.",
  "You are given the whole of the relevant window; if something is not in it, say you cannot see it rather than guessing.",
  "Answer in one or two short sentences, in Australian English, naming specific days and times.",
  "A day listed as (nothing on) is free. Do not describe a day as busy unless something is listed against it.",
  "If the question cannot be answered from what you were given, say exactly what is missing.",
  "Never invent an event, an item or a date.",
].join(" ");
