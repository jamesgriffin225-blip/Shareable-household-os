import { blinkProxyConfigured, liveMedia, validMediaFile, validSlug } from "@/lib/blink";
import { fail, handle } from "@/lib/http";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * The HLS stream, re-served from our own origin.
 *
 * Two reasons it goes through here rather than the browser talking to the
 * proxy directly. The token stays on the server — it is a key to the cameras,
 * and a query string in a browser is not a place to keep one. And the phone
 * reaches this app over Tailscale but has no route to port 8088 on the
 * Surface, so a URL pointing at the proxy would work at the wall and nowhere
 * else.
 *
 * The playlist's segment names are relative, so they resolve back to this same
 * route and come through the same way.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string; file: string }> },
) {
  try {
    if (!blinkProxyConfigured()) return fail("Live view is not configured", 503);

    const { slug, file } = await params;
    if (!validSlug(slug)) return fail("Not a camera", 400);
    if (!validMediaFile(file)) return fail("Not a media file", 400);

    // The playlist's segments carry their own tokens; pass the query through
    // rather than substituting ours, or every segment is refused.
    const { body, contentType } = await liveMedia(
      slug,
      file,
      new URL(request.url).search,
    );
    return new Response(body, {
      headers: {
        "content-type": contentType,
        // A live playlist that gets cached is a still picture with extra steps.
        "cache-control": "no-store, no-cache, must-revalidate",
      },
    });
  } catch (error) {
    return handle(error);
  }
}
