import { getState, setState } from "@/lib/db";
import { handle, json, readJson, requireProfile } from "@/lib/http";
import { FRAME_KEY } from "@/lib/state";
import { normaliseFrame, type FrameSettings } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const stored = await getState<unknown>(FRAME_KEY);
    return json(normaliseFrame(stored?.value));
  } catch (error) {
    return handle(error);
  }
}

/** What the wall shows. Shared, so the phone can change it from the sofa. */
export async function PUT(request: Request) {
  try {
    const body = await readJson<Partial<FrameSettings> & { profileId?: string }>(request);
    await requireProfile(request, body);

    const current = normaliseFrame((await getState<unknown>(FRAME_KEY))?.value);
    const next = normaliseFrame({ ...current, ...body });
    await setState(FRAME_KEY, next);
    return json(next);
  } catch (error) {
    return handle(error);
  }
}
