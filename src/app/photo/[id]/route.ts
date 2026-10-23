import { one } from "@/lib/db";
import { handle } from "@/lib/http";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/**
 * The bytes themselves.
 *
 * Deliberately outside /api, which the app blankets in `no-store` — a photo
 * at a given id never changes, and a slideshow on a wall tablet should be
 * hitting the browser cache, not the database, every twelve seconds.
 */
export async function GET(request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const thumb = new URL(request.url).searchParams.get("size") === "thumb";

    const row = await one<{
      bytes: Buffer;
      thumb_bytes: Buffer | null;
      media_type: string;
    }>(
      "select bytes, thumb_bytes, media_type from photos where id = $1 and removed_at is null",
      [id],
    );
    if (!row) return new Response("Not found", { status: 404 });

    const body = thumb && row.thumb_bytes ? row.thumb_bytes : row.bytes;
    return new Response(new Uint8Array(body), {
      headers: {
        "content-type": row.media_type,
        "content-length": String(body.byteLength),
        "cache-control": "private, max-age=31536000, immutable",
      },
    });
  } catch (error) {
    return handle(error);
  }
}
