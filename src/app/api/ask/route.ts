import {
  ASK_SYSTEM,
  formatBriefing,
  LOOK_AHEAD_DAYS,
  LOOK_BEHIND_DAYS,
} from "@/lib/briefing";
import { addDayKeys, dayKeysIn } from "@/components/Dashboard/calendar-range";
import { listConnections, ReconnectRequired } from "@/lib/connections";
import { listCalendarEvents } from "@/lib/google";
import { askHousehold, claudeConfigured } from "@/lib/llm";
import { fail, handle, json, readJson } from "@/lib/http";
import { loadState } from "@/lib/state";
import { listProfiles } from "@/lib/profiles";
import { addDays, dateKey, fromWallClock, householdTimezone } from "@/lib/time";
import type { CalendarEvent } from "@/lib/types";

export const dynamic = "force-dynamic";
// Two months of calendar plus a model call. Slower than a tap, faster than
// opening two calendars and counting.
export const maxDuration = 60;

const MAX_QUESTION = 400;

/**
 * Ask the household a question.
 *
 * Read-only by construction, and that is the whole design. The model is handed
 * a briefing and returns prose; no tool call comes back and nothing here can
 * write. "When are we next free?" must never be a path to moving an
 * appointment, and the way to guarantee that is to give the question no
 * machinery to do it with rather than to ask it nicely.
 */
export async function POST(request: Request) {
  try {
    if (!claudeConfigured()) {
      return fail("Claude is not configured on this deployment", 503);
    }

    const body = await readJson<{ question?: string }>(request);
    const question = typeof body.question === "string" ? body.question.trim() : "";
    if (!question) return fail("Ask something", 400);
    if (question.length > MAX_QUESTION) {
      return fail(`Keep it under ${MAX_QUESTION} characters`, 400);
    }

    const timeZone = householdTimezone();
    const todayKey = dateKey(new Date(), timeZone);
    const from = addDayKeys(todayKey, -LOOK_BEHIND_DAYS);
    const to = addDayKeys(todayKey, LOOK_AHEAD_DAYS);

    // One read of everything the dashboard already polls, rather than three.
    const [profiles, state, connections] = await Promise.all([
      listProfiles(),
      loadState(),
      listConnections(),
    ]);

    const google = connections.filter(
      (connection) => connection.provider === "google",
    );
    const results = await Promise.allSettled(
      google.map(async (connection) => {
          const events = await listCalendarEvents(
            connection,
            fromWallClock(from)!,
            addDays(fromWallClock(to)!, 1),
          );
          return events.map(
            (event): CalendarEvent => ({
              id: `${connection.profileId}:${event.id}`,
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
    const missing: string[] = [];
    results.forEach((result, index) => {
      if (result.status === "fulfilled") events.push(...result.value);
      // A calendar we could not read is named in the answer rather than
      // silently left out: "you're free on Saturday" is a different claim when
      // one of the two diaries was unreadable.
      else missing.push(
        result.reason instanceof ReconnectRequired
          ? `${google[index].profileId} (needs reconnecting)`
          : google[index].profileId,
      );
    });
    events.sort((a, b) => a.start.localeCompare(b.start));

    const briefing = formatBriefing({
      todayKey,
      timeZone,
      profiles,
      events,
      shopping: state.shopping,
      reminders: state.reminders,
      days: dayKeysIn({ from, to }),
    });

    const answer = await askHousehold({
      question,
      briefing:
        missing.length > 0
          ? `${briefing}\n\nWARNING: could not read the calendar for ${missing.join(", ")}. Say so in your answer.`
          : briefing,
      system: ASK_SYSTEM,
    });

    return json({ answer, missing, from, to });
  } catch (error) {
    return handle(error);
  }
}
