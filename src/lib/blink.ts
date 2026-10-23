/**
 * Live view, by way of a local Blink proxy.
 *
 * Home Assistant gives us stills and motion; it has never supported live
 * streaming from Blink, because Blink does not hand out RTSP. Live view
 * returns `immis://` — Amazon's own framing, which ffmpeg, go2rtc and every
 * other standard tool cannot read. The proxy is the one thing that speaks it,
 * and it re-serves the result as HLS on the LAN.
 *
 * So this file talks to the proxy, not to Blink, and the dashboard talks to
 * this. The proxy's token never leaves the server: the browser asks our own
 * origin for the playlist and the segments, and the route adds the token on
 * the way through.
 */

const SLUG = /^[a-z0-9][a-z0-9_-]{0,63}$/;
/** Playlist or segment, nothing else, and nothing that climbs out of a path. */
const MEDIA_FILE = /^[a-zA-Z0-9._-]{1,80}\.(m3u8|ts|mp4|m4s|aac)$/;

export function blinkProxyConfigured(): boolean {
  return Boolean(process.env.BLINK_PROXY_URL && token());
}

/**
 * Trimmed, because this value is copied out of a container and pasted into a
 * file, and a stray space or newline on the end buys a 401 that reads like a
 * wrong token rather than a wrong paste.
 */
function token(): string {
  return (process.env.BLINK_PROXY_TOKEN || "").trim();
}

function base(): string {
  const url = process.env.BLINK_PROXY_URL;
  if (!url) throw new Error("BLINK_PROXY_URL is not set");
  return url.replace(/\/$/, "");
}

export function validSlug(slug: string): boolean {
  return SLUG.test(slug);
}

export function validMediaFile(file: string): boolean {
  return MEDIA_FILE.test(file) && !file.includes("..");
}

async function proxyFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const response = await fetch(`${base()}${path}`, {
    ...init,
    headers: {
      ...(init.headers as Record<string, string> | undefined),
      authorization: `Bearer ${token()}`,
    },
    cache: "no-store",
    signal: AbortSignal.timeout(Number(process.env.BLINK_PROXY_TIMEOUT_MS || 15000)),
  });
  if (!response.ok) {
    // 401 here means the token, every time — it is the only credential in play.
    throw new Error(
      response.status === 401
        ? "Blink proxy rejected BLINK_PROXY_TOKEN. Re-read it with: " +
          "docker exec blink-liveview-proxy cat /data/proxy-token"
        : `Blink proxy ${response.status} on ${path.split("?")[0]}`,
    );
  }
  return response;
}

export interface ProxyCamera {
  slug: string;
  name: string;
}

/** Whatever shape the proxy reports, reduced to a slug and a name. */
export function readProxyCameras(raw: unknown): ProxyCamera[] {
  const list = Array.isArray(raw)
    ? raw
    : Array.isArray((raw as any)?.cameras)
      ? (raw as any).cameras
      : [];
  return list
    .map((entry: any): ProxyCamera | null => {
      const slug = String(entry?.slug ?? entry?.id ?? "").trim();
      if (!slug || !SLUG.test(slug)) return null;
      return { slug, name: String(entry?.name ?? entry?.title ?? slug).trim() };
    })
    .filter((camera: ProxyCamera | null): camera is ProxyCamera => camera !== null);
}

export async function listProxyCameras(): Promise<ProxyCamera[]> {
  const response = await proxyFetch("/cameras");
  return readProxyCameras(await response.json().catch(() => null));
}

/**
 * Which proxy camera is this Home Assistant camera?
 *
 * The two systems name the same device independently — `camera.front_patio`
 * against whatever slug the proxy derives from Blink's own name — so match on
 * the entity's object id first and fall back to the friendly name flattened
 * the same way. A miss means no Live button on that tile, never the wrong
 * camera's picture.
 */
export function flatten(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

export function matchSlug(
  entityId: string,
  friendlyName: string,
  cameras: ProxyCamera[],
): string | null {
  const objectId = flatten(entityId.slice(entityId.indexOf(".") + 1));
  const byId = cameras.find((camera) => flatten(camera.slug) === objectId);
  if (byId) return byId.slug;

  const name = flatten(friendlyName);
  const byName = cameras.find(
    (camera) => flatten(camera.slug) === name || flatten(camera.name) === name,
  );
  return byName?.slug ?? null;
}

/**
 * The query to send with a media request.
 *
 * The playlist names its segments with a token of their own —
 * `segment_00000.ts?token=4c73...` — which is not the proxy token and is the
 * only thing that fetches that segment. Replacing it with ours gets every
 * segment refused, which looks exactly like a camera that never woke up.
 *
 * So whatever the playlist put on the URL is carried through untouched, and
 * the proxy token is only a fallback for a request that arrived without one
 * (the playlist itself).
 */
export function mediaQuery(search: string, fallback: string): string {
  const params = new URLSearchParams(search);
  if (!params.get("token")) params.set("token", fallback);
  return params.toString();
}

/**
 * Fetch one HLS file from the proxy.
 *
 * Media routes take the token in the query string; the auth routes refuse it
 * there, which is the right way round and not something to work around.
 */
export async function liveMedia(
  slug: string,
  file: string,
  search = "",
): Promise<{ body: ReadableStream<Uint8Array> | null; contentType: string }> {
  if (!validSlug(slug)) throw new Error("Not a camera");
  if (!validMediaFile(file)) throw new Error("Not a media file");

  const response = await fetch(
    `${base()}/cameras/${slug}/hls/${file}?${mediaQuery(search, token())}`,
    { cache: "no-store", signal: AbortSignal.timeout(20000) },
  );
  if (!response.ok) {
    throw new Error(`Blink proxy ${response.status} fetching ${file}`);
  }
  return {
    body: response.body,
    contentType:
      response.headers.get("content-type") ||
      (file.endsWith(".m3u8") ? "application/vnd.apple.mpegurl" : "video/mp2t"),
  };
}
