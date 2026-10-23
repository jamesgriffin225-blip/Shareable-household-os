import { listConnections, ReconnectRequired } from "@/lib/connections";
import { eventKey, listCalendarEvents } from "@/lib/google";
import { handle, json } from "@/lib/http";
import { addDays, dateKey, fromWallClock, startOfWeek } from "@/lib/time";
import type { CalendarEvent } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Live read of both Google Calendars. Nothing is cached in Postgres — the
 * calendar has one owner and it is not this app.
 *
 * The range comes from the client as two day-keys, because the client is the
 * one that knows which week or month is on screen. `to` is inclusive: it names
 * the last day shown, and the fetch runs to the end of it.
 */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const fromParam = url.searchParams.get("from");
    const toParam = url.searchParams.get("to");

    let from: Date;
    let to: Date;
    if (fromParam && DAY_KEY.test(fromParam) && toParam && DAY_KEY.test(toParam)) {
      from = fromWallClock(fromParam)!;
      to = addDays(fromWallClock(toParam)!, 1);
    } else {
      // No range asked for: this week, which is what the wall wants on boot.
      from = startOfWeek(new Date());
      to = addDays(from, 7);
    }

    const connections = (await listConnections()).filter(
      (connection) => connection.provider === "google",
    );

    const results = await Promise.allSettled(
      connections.map(async (connection) => {
        const events = await listCalendarEvents(connection, from, to);
        return events.map(
          (event): CalendarEvent => ({
            id: eventKey(connection.profileId, event.id),
            profileId: connection.profileId,
            title: event.title,
            start: event.start,
            end: event.end,
            allDay: event.allDay,
            location: event.location,
            notes: event.notes,
            htmlLink: event.htmlLink,
          }),
        );
      }),
    );

    const events: CalendarEvent[] = [];
    const errors: string[] = [];
    const reconnect: string[] = [];
    results.forEach((result, index) => {
      if (result.status === "fulfilled") {
        events.push(...result.value);
        return;
      }
      // One broken connection must not blank the other person's week.
      //
      // A dead refresh token is its own outcome, not an error message: there is
      // one thing to do about it and the panel should say that thing rather
      // than print what Google said.
      if (result.reason instanceof ReconnectRequired) {
        reconnect.push(connections[index].profileId);
      } else {
        errors.push(`${connections[index].profileId}: ${result.reason?.message ?? result.reason}`);
      }
    });

    events.sort((a, b) => a.start.localeCompare(b.start));

    return json({
      from: dateKey(from),
      to: dateKey(addDays(to, -1)),
      connected: connections.map((connection) => connection.profileId),
      events,
      errors,
      reconnect,
    });
  } catch (error) {
    return handle(error);
  }
}
