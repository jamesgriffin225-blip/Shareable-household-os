import { requestSnapshot, validCameraId } from "@/lib/cameras";
import { fail, handle, json, readJson, requireProfile } from "@/lib/http";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(request: Request) {
  try {
    const body = await readJson<{ entityId?: string; profileId?: string }>(request);
    await requireProfile(request, body);
    if (!body.entityId || !validCameraId(body.entityId)) {
      return fail("Which camera?", 400);
    }
    return json({ ok: true, via: await requestSnapshot(body.entityId) });
  } catch (error) {
    return handle(error);
  }
}
