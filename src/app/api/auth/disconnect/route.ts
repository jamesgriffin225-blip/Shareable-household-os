import { removeConnection } from "@/lib/connections";
import { fail, handle, json, readJson, requireProfile } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await readJson<{ provider?: string; profileId?: string }>(request);
    const profileId = await requireProfile(request, body);
    if (body.provider !== "google" && body.provider !== "microsoft" && body.provider !== "spotify") {
      return fail("Which provider?", 400);
    }
    await removeConnection(profileId, body.provider);
    return json({ ok: true });
  } catch (error) {
    return handle(error);
  }
}
