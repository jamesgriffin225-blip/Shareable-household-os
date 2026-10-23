import { cameraImage, homeAssistantConfigured, validCameraId } from "@/lib/cameras";

export const dynamic = "force-dynamic";
export const maxDuration = 20;

type Params = { params: Promise<{ entity: string }> };

/**
 * The current still for one camera, proxied.
 *
 * Home Assistant lives on a home network behind a token the browser must never
 * see, so the image comes through here. The entity id is validated against a
 * strict pattern before it reaches a URL — this is a server on the public
 * internet making requests into a house.
 */
export async function GET(_request: Request, { params }: Params) {
  const { entity } = await params;

  if (!homeAssistantConfigured()) return new Response("Not configured", { status: 503 });
  if (!validCameraId(entity)) return new Response("Not a camera", { status: 400 });

  try {
    const image = await cameraImage(entity);
    return new Response(image.body, {
      headers: {
        "content-type": image.contentType,
        // Long enough that a dashboard refresh doesn't wake the camera twice,
        // short enough that the wall is not showing yesterday.
        "cache-control": "private, max-age=20",
      },
    });
  } catch (error) {
    console.error("[camera]", error);
    return new Response("Camera unavailable", { status: 502 });
  }
}
