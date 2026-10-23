import { addDays, dateKey, fromWallClock } from "../../lib/time.ts";
import type { CalendarEvent } from "../../lib/types.ts";

export interface AgendaEvent extends CalendarEvent {
  /** Finished already. Kept, but shown faded — see `groupAgenda`. */
  past: boolean;
}

export interface AgendaDay {
  key: string;
  /** "Today", "Tomorrow", or "Fri 12 Sep". */
  label: string;
  today: boolean;
  events: AgendaEvent[];
}

/**
 * The week, read the way a phone wants it: forwards from today, one day per
 * heading, empty days left out.
 *
 * The wall display gets seven columns because it has the width and because
 * seeing Thursday is empty is half the point of a wall planner. A phone has
 * neither, so this drops the blanks — except today's, which is always kept:
 * an agenda that opens on Thursday because Tuesday is clear reads as a bug,
 * and "Nothing on today" is information.
 *
 * Events that have already finished stay, faded. Dropping them silently is
 * how you get "where did swimming go?" at four in the afternoon.
 */
export function groupAgenda(
  events: CalendarEvent[],
  { now, timeZone, days = 7 }: { now: Date; timeZone: string; days?: number },
): AgendaDay[] {
  const todayKey = dateKey(now, timeZone);
  const midnight = fromWallClock(todayKey, timeZone) ?? now;

  const out: AgendaDay[] = [];
  for (let index = 0; index < days; index++) {
    // Anchored at midday so a daylight-saving shift can't roll the date
    // forwards or backwards a day. Brisbane doesn't have one; a holiday and a
    // laptop in another timezone do.
    const noon = addDays(midnight, index).getTime() + 12 * 3_600_000;
    const date = new Date(noon);
    const key = dateKey(date, timeZone);
    const today = key === todayKey;

    const onThisDay = events
      .filter((event) => {
        const eventKey = event.allDay
          ? event.start.slice(0, 10)
          : dateKey(new Date(event.start), timeZone);
        return eventKey === key;
      })
      .sort((a, b) => {
        if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
        return a.start.localeCompare(b.start);
      })
      .map((event) => ({
        ...event,
        past: !event.allDay && new Date(event.end || event.start) < now,
      }));

    if (onThisDay.length === 0 && !today) continue;

    out.push({
      key,
      today,
      label: today
        ? "Today"
        : index === 1
          ? "Tomorrow"
          : // en-GB rather than en-AU purely for the heading's shape: en-AU
            // punctuates this as "Sun, 13 Sept", and the comma buys nothing
            // above a list of times.
            new Intl.DateTimeFormat("en-GB", {
              timeZone,
              weekday: "short",
              day: "numeric",
              month: "short",
            }).format(date),
      events: onThisDay,
    });
  }
  return out;
}
