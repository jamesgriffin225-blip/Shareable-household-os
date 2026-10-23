import { logActivity } from "@/lib/actions";
import { categoriseItem, claudeConfigured } from "@/lib/llm";
import { one } from "@/lib/db";
import { fail, handle, json, readJson, requireProfile } from "@/lib/http";
import { normaliseCategory } from "@/lib/types";

export const dynamic = "force-dynamic";

/** Typed straight onto the dashboard. Claude still picks the aisle. */
export async function POST(request: Request) {
  try {
    const body = await readJson<{
      name?: string;
      quantity?: string;
      unit?: string;
      category?: string;
      profileId?: string;
    }>(request);
    const profileId = await requireProfile(request, body);

    const name = (body.name || "").trim();
    if (!name) return fail("Give the item a name", 400);

    const category = body.category
      ? normaliseCategory(body.category)
      : claudeConfigured()
        ? normaliseCategory(await categoriseItem(name))
        : "Other";

    const row = await one<{ id: string }>(
      `insert into shopping_items (name, quantity, unit, category, added_by, source)
       values ($1, $2, $3, $4, $5, 'manual') returning id`,
      [name, body.quantity?.trim() || null, body.unit?.trim() || null, category, profileId],
    );

    const activityId = await logActivity({
      action: "add_shopping_items",
      summary: `${name} → shopping list`,
      profileId,
      source: "manual",
      entityType: "shopping_items",
      entityId: row!.id,
      undo: { kind: "shopping", ids: [row!.id] },
    });

    return json({ id: row!.id, category, activityId });
  } catch (error) {
    return handle(error);
  }
}
