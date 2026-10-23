import { logActivity } from "@/lib/actions";
import { one } from "@/lib/db";
import { fail, handle, json, readJson, requireProfile } from "@/lib/http";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/**
 * Ticking an item off. The row is not deleted: it stays visible for a few
 * seconds with an undo, on every screen, and then falls out of the query.
 */
export async function PATCH(request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const body = await readJson<{ checked?: boolean; profileId?: string }>(request);
    const profileId = await requireProfile(request, body);
    const checked = body.checked !== false;

    const row = await one<{ name: string }>(
      `update shopping_items set checked_at = ${checked ? "now()" : "null"},
         updated_at = now()
       where id = $1 and removed_at is null returning name`,
      [id],
    );
    if (!row) return fail("That item is already gone", 404);

    const activityId = await logActivity({
      action: checked ? "check_shopping_item" : "uncheck_shopping_item",
      summary: checked ? `Ticked off ${row.name}` : `Put ${row.name} back on the list`,
      profileId,
      source: "manual",
      entityType: "shopping_item",
      entityId: id,
      undo: checked ? { kind: "uncheck", id } : null,
    });

    return json({ ok: true, activityId });
  } catch (error) {
    return handle(error);
  }
}

/** Remove without ticking — a mistake, not a purchase. */
export async function DELETE(request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const profileId = await requireProfile(request);
    const row = await one<{ name: string }>(
      "update shopping_items set removed_at = now(), updated_at = now() where id = $1 returning name",
      [id],
    );
    if (!row) return fail("Not found", 404);
    await logActivity({
      action: "remove_shopping_item",
      summary: `Removed ${row.name} from the list`,
      profileId,
      source: "manual",
      entityType: "shopping_item",
      entityId: id,
    });
    return json({ ok: true });
  } catch (error) {
    return handle(error);
  }
}
