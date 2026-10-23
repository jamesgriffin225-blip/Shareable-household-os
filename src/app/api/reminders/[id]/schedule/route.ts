import { runToolCall } from "@/lib/actions";
import { one } from "@/lib/db";
import { fail, handle, json, readJson, requireProfile } from "@/lib/http";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * Put a to-do on somebody's calendar.
 *
 * The reminder stays where it is. Scheduling a job is not finishing it, and
 * quietly clearing the list because a date got picked would be the kind of
 * surprise that stops people trusting the button -- there is a remove on every
 * row now if that is what was wanted.
 *
 * The work goes through `runToolCall`, the same executor the voice capture and
 * the mailbox scanner use, so the activity entry, the undo and the "which
 * calendar" resolution are the ones that already exist rather than a second
 * set that can drift from them.
 */
export async function POST(request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const body = await readJson<{
      date?: string;
      time?: string | null;
      forProfile?: string | null;
      profileId?: string;
    }>(request);
    const profileId = await requireProfile(request, body);

    const date = typeof body.date === "string" ? body.date : "";
    if (!DAY.test(date)) return fail("Pick a date", 400);

    // No time means all day, which is the honest default for a job rather
    // than a meeting: "call the plumber" is not 9am to 10am.
    const time = typeof body.time === "string" && body.time ? body.time : null;
    if (time !== null && !TIME.test(time)) return fail("That is not a time", 400);

    const reminder = await one<{ title: string; notes: string | null }>(
      "select title, notes from reminders where id = $1 and removed_at is null",
      [id],
    );
    if (!reminder) return fail("Not found", 404);

    const outcome = await runToolCall(
      "add_calendar_event",
      {
        title: reminder.title,
        // A wall clock, never an offset: `HOUSEHOLD_TIMEZONE` resolves it,
        // exactly as it does for a dictated "Thursday at four".
        start: time ? `${date}T${time}` : date,
        all_day: time === null,
        notes: reminder.notes,
        for_profile: typeof body.forProfile === "string" ? body.forProfile : null,
      },
      { profileId, source: "manual" },
      // A person pressed a button: it is not a guess to be approved, and a
      // failure belongs on their screen rather than parked in the queue.
      { force: true, queueOnError: false },
    );

    if (!outcome.executed) return fail(outcome.error ?? "Could not add it", 502);
    return json({ ok: true, summary: outcome.summary, activityId: outcome.activityId });
  } catch (error) {
    return handle(error);
  }
}
