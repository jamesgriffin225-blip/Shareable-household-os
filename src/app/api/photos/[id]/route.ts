import { logActivity } from "@/lib/actions";
import { one } from "@/lib/db";
import { fail, handle, json, readJson, requireProfile } from "@/lib/http";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const body = await readJson<{ caption?: string; profileId?: string }>(request);
    await requireProfile(request, body);
    const row = await one<{ id: string }>(
      "update photos set caption = $2 where id = $1 and removed_at is null returning id",
      [id, (body.caption ?? "").trim() || null],
    );
    if (!row) return fail("Not found", 404);
    return json({ ok: true });
  } catch (error) {
    return handle(error);
  }
}

export async function DELETE(request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const profileId = await requireProfile(request);
    // Soft delete: the bytes go on the next tidy-up, but a mis-tap on a wall
    // display should not destroy the only copy of a photo.
    const row = await one<{ caption: string | null }>(
      "update photos set removed_at = now() where id = $1 and removed_at is null returning caption",
      [id],
    );
    if (!row) return fail("Not found", 404);

    await logActivity({
      action: "remove_photo",
      summary: `Removed ${row.caption ? `“${row.caption}”` : "a photo"} from the frame`,
      profileId,
      source: "manual",
      entityType: "photo",
      entityId: id,
      undo: { kind: "restore_photo", id },
    });
    return json({ ok: true });
  } catch (error) {
    return handle(error);
  }
}
