import { undoActivity } from "@/lib/actions";
import { fail, handle, json, readJson } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await readJson<{ activityId?: number }>(request);
    const activityId = Number(body.activityId);
    if (!Number.isFinite(activityId)) return fail("Which one?", 400);

    const undone = await undoActivity(activityId);
    if (!undone) return fail("Nothing left to undo there", 409);
    return json({ ok: true });
  } catch (error) {
    return handle(error);
  }
}
