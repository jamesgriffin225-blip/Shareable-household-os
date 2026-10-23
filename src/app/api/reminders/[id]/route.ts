import { logActivity } from "@/lib/actions";
import { one } from "@/lib/db";
import { fail, handle, json, readJson, requireProfile } from "@/lib/http";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const body = await readJson<{ done?: boolean; profileId?: string }>(request);
    const profileId = await requireProfile(request, body);
    const done = body.done !== false;

    const row = await one<{ title: string }>(
      `update reminders set done_at = ${done ? "now()" : "null"}, updated_at = now()
       where id = $1 and removed_at is null returning title`,
      [id],
    );
    if (!row) return fail("Not found", 404);

    await logActivity({
      action: done ? "complete_reminder" : "reopen_reminder",
      summary: done ? `Done: ${row.title}` : `Reopened: ${row.title}`,
      profileId,
      source: "manual",
      entityType: "reminder",
      entityId: id,
    });
    return json({ ok: true });
  } catch (error) {
    return handle(error);
  }
}

export async function DELETE(request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const profileId = await requireProfile(request);
    const row = await one<{ title: string }>(
      "update reminders set removed_at = now(), updated_at = now() where id = $1 returning title",
      [id],
    );
    if (!row) return fail("Not found", 404);
    await logActivity({
      action: "remove_reminder",
      summary: `Removed reminder: ${row.title}`,
      profileId,
      source: "manual",
      entityType: "reminder",
      entityId: id,
      // Removing is a tap with no confirmation, so it has to be reversible
      // from the activity feed like everything else that can be undone here.
      undo: { kind: "restore_row", table: "reminders", id },
    });
    return json({ ok: true });
  } catch (error) {
    return handle(error);
  }
}
