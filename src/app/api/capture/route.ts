import { runToolCall, type ActionOutcome } from "@/lib/actions";
import { claudeConfigured, parseCapture } from "@/lib/llm";
import { sql } from "@/lib/db";
import { fail, handle, json, requireProfile } from "@/lib/http";
import { listProfiles } from "@/lib/profiles";
import type { Source } from "@/lib/types";

export const dynamic = "force-dynamic";
// Vision on a phone photo plus several tool calls: give it room.
export const maxDuration = 60;

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];

export async function POST(request: Request) {
  try {
    if (!claudeConfigured()) {
      return fail("ANTHROPIC_API_KEY is not set — capture can't parse anything", 503);
    }

    let text: string | null = null;
    let kind: "voice" | "photo" | "text" = "text";
    let image: { mediaType: string; data: string } | null = null;
    let bodyProfile: string | null = null;

    const contentType = request.headers.get("content-type") || "";
    if (contentType.includes("multipart/form-data")) {
      const form = await request.formData();
      text = (form.get("text") as string | null)?.trim() || null;
      bodyProfile = (form.get("profileId") as string | null) || null;
      kind = ((form.get("kind") as string | null) || "text") as typeof kind;

      const file = form.get("image");
      if (file && typeof file !== "string") {
        if (file.size > MAX_IMAGE_BYTES) {
          return fail("That photo is too big — try again, it will be recompressed", 413);
        }
        const mediaType = file.type || "image/jpeg";
        if (!ALLOWED_IMAGE_TYPES.includes(mediaType)) {
          return fail(`Unsupported image type ${mediaType}`, 415);
        }
        image = {
          mediaType,
          data: Buffer.from(await file.arrayBuffer()).toString("base64"),
        };
        kind = "photo";
      }
    } else {
      const body = (await request.json().catch(() => ({}))) as Record<string, any>;
      text = typeof body.text === "string" ? body.text.trim() : null;
      bodyProfile = typeof body.profileId === "string" ? body.profileId : null;
      kind = body.kind === "voice" ? "voice" : "text";
    }

    const profileId = await requireProfile(request, { profileId: bodyProfile });
    if (!text && !image) return fail("Nothing to work with", 400);

    const profiles = await listProfiles();
    const capturedBy = profiles.find((profile) => profile.id === profileId)!;
    const recipeNames = (
      await sql<{ name: string }>("select name from recipes order by lower(name) limit 100")
    ).map((row) => row.name);

    const parsed = await parseCapture({
      text,
      image,
      kind,
      context: { capturedBy, profiles, recipes: recipeNames },
    });

    const source: Source = image ? "photo" : kind === "voice" ? "voice" : "manual";
    const outcomes: ActionOutcome[] = [];
    for (const call of parsed.calls) {
      outcomes.push(
        await runToolCall(call.name, call.input, {
          profileId,
          source,
          sourceRef: { transcript: text ?? undefined, kind },
        }),
      );
    }

    return json({
      reply: parsed.reply,
      outcomes,
      executed: outcomes.filter((outcome) => outcome.executed).length,
      queued: outcomes.filter((outcome) => outcome.approvalId).length,
    });
  } catch (error) {
    return handle(error);
  }
}
