import { logActivity } from "@/lib/actions";
import { setArmed, validPanelId, type ArmMode } from "@/lib/cameras";
import { fail, handle, json, readJson, requireProfile } from "@/lib/http";

export const dynamic = "force-dynamic";
export const maxDuration = 20;

const MODES: ArmMode[] = ["away", "home", "disarm"];

export async function POST(request: Request) {
  try {
    const body = await readJson<{ entityId?: string; mode?: ArmMode; profileId?: string }>(
      request,
    );
    const profileId = await requireProfile(request, body);

    if (!body.entityId || !validPanelId(body.entityId)) {
      return fail("Which panel?", 400);
    }
    if (!body.mode || !MODES.includes(body.mode)) return fail("Which mode?", 400);

    await setArmed(body.entityId, body.mode);

    // Arming and disarming the house is exactly the kind of thing you want a
    // name and a timestamp against.
    await logActivity({
      action: "set_alarm",
      summary:
        body.mode === "disarm"
          ? "Disarmed the cameras"
          : `Armed the cameras (${body.mode})`,
      profileId,
      source: "manual",
      entityType: "alarm_panel",
      entityId: body.entityId,
    });

    return json({ ok: true });
  } catch (error) {
    return handle(error);
  }
}
