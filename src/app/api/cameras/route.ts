import { cameraSnapshot, homeAssistantConfigured } from "@/lib/cameras";
import { blinkProxyConfigured, listProxyCameras, matchSlug } from "@/lib/blink";
import { json } from "@/lib/http";

export const dynamic = "force-dynamic";
export const maxDuration = 20;

/**
 * A camera panel that cannot reach home must not take the dashboard with it —
 * the shopping list is still useful when the tunnel is down.
 */
export async function GET() {
  try {
    if (!homeAssistantConfigured()) {
      return json({ configured: false, cameras: [], panels: [], error: null });
    }
    const snapshot = await cameraSnapshot();

    // Live view is a separate service and an optional one. A proxy that is
    // down, restarting or half-way through a Blink login must cost the stills
    // nothing — the tiles come back without a Live button.
    //
    // But it says why, in the panel and not only in a log nobody is reading:
    // "the button is missing" and "the token is wrong" look identical from the
    // wall, and telling them apart took a round trip.
    let liveError: string | null = null;
    if (blinkProxyConfigured()) {
      try {
        const proxied = await listProxyCameras();
        for (const camera of snapshot.cameras) {
          camera.liveSlug = matchSlug(camera.entityId, camera.name, proxied);
        }
      } catch (error) {
        liveError = error instanceof Error ? error.message : String(error);
        console.warn("[cameras] live proxy unavailable", error);
      }
    }

    return json({ configured: true, ...snapshot, error: null, liveError });
  } catch (error) {
    return json({
      configured: true,
      cameras: [],
      panels: [],
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
