import { logActivity } from "@/lib/actions";
import { one } from "@/lib/db";
import { fail, handle, json, requireProfile } from "@/lib/http";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function DELETE(request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const profileId = await requireProfile(request);
    const row = await one<{ name: string }>(
      "delete from recipes where id = $1 returning name",
      [id],
    );
    if (!row) return fail("Not found", 404);
    await logActivity({
      action: "delete_recipe",
      summary: `Deleted recipe ${row.name}`,
      profileId,
      source: "manual",
      entityType: "recipe",
      entityId: id,
    });
    return json({ ok: true });
  } catch (error) {
    return handle(error);
  }
}
