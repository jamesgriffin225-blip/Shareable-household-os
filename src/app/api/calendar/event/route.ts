import { removeCalendarEvent } from "@/lib/actions";
import { splitEventKey } from "@/lib/google";
import { fail, handle, json, readJson, requireProfile } from "@/lib/http";

export const dynamic = "force-dynamic";

interface Body {
  /** As the dashboard knows it: "alex:abc123". */
  id?: string;
  title?: string;
  start?: string;
  end?: string;
  allDay?: boolean;
  location?: string | null;
  notes?: string | null;
  profileId?: string;
}

/**
 * Take an event off a calendar.
 *
 * The body carries the event as well as its id, because Google cannot undelete
 * and the undo is a re-insert. Reading it back before deleting would be one
 * more round trip for fields the screen already has in its hand.
 */
export async function DELETE(request: Request) {
  try {
    const body = await readJson<Body>(request);
    // Who pressed it, for the activity feed. Whose calendar it is comes from
    // the event id, and they are not always the same person.
    const removedBy = await requireProfile(request, body as Record<string, unknown>);

    const target = splitEventKey(typeof body.id === "string" ? body.id : "");
    if (!target) return fail("Not an event id", 400);

    const title = typeof body.title === "string" ? body.title.trim() : "";
    const start = typeof body.start === "string" ? body.start : "";
    if (!title || !start) return fail("Missing the event to remove", 400);

    const activityId = await removeCalendarEvent({
      profileId: target.profileId,
      eventId: target.eventId,
      event: {
        title,
        start,
        end: typeof body.end === "string" ? body.end : undefined,
        allDay: body.allDay === true,
        location: body.location ?? null,
        notes: body.notes ?? null,
      },
      source: "manual",
      removedBy,
    });

    return json({ ok: true, activityId });
  } catch (error) {
    return handle(error);
  }
}
