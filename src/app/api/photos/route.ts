import { logActivity } from "@/lib/actions";
import { one } from "@/lib/db";
import { fail, handle, json, requireProfile } from "@/lib/http";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// Vercel's serverless request body ceiling is 4.5MB, so the client sends one
// photo per request, already downscaled. This is the backstop, not the plan.
const MAX_BYTES = 4 * 1024 * 1024;
const ALLOWED = ["image/jpeg", "image/png", "image/webp"];

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const profileId = await requireProfile(request, {
      profileId: (form.get("profileId") as string | null) ?? undefined,
    });

    const file = form.get("image");
    if (!file || typeof file === "string") return fail("No image", 400);
    if (file.size > MAX_BYTES) return fail("That photo is too large", 413);

    const mediaType = file.type || "image/jpeg";
    if (!ALLOWED.includes(mediaType)) {
      return fail(`Unsupported image type ${mediaType}`, 415);
    }

    const thumb = form.get("thumb");
    const caption = ((form.get("caption") as string | null) ?? "").trim() || null;
    const width = Number(form.get("width")) || null;
    const height = Number(form.get("height")) || null;

    const bytes = Buffer.from(await file.arrayBuffer());
    const thumbBytes =
      thumb && typeof thumb !== "string"
        ? Buffer.from(await thumb.arrayBuffer())
        : null;

    const row = await one<{ id: string }>(
      `insert into photos (caption, media_type, bytes, thumb_bytes, width, height, size_bytes, added_by)
       values ($1, $2, $3, $4, $5, $6, $7, $8) returning id`,
      [caption, mediaType, bytes, thumbBytes, width, height, bytes.byteLength, profileId],
    );

    const activityId = await logActivity({
      action: "add_photo",
      summary: caption ? `Photo: ${caption}` : "Photo added to the frame",
      profileId,
      source: "photo",
      entityType: "photo",
      entityId: row!.id,
      undo: { kind: "photo", id: row!.id },
    });

    return json({ id: row!.id, activityId });
  } catch (error) {
    return handle(error);
  }
}
