import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * OAuth `state` is signed rather than stored. There are two of us and four
 * mailboxes; a table row per in-flight authorisation would be more moving
 * parts than the thing it protects.
 */
function secret(): string {
  const value = process.env.APP_SECRET;
  if (!value) {
    throw new Error(
      "APP_SECRET is not set — required to sign OAuth state parameters",
    );
  }
  return value;
}

export function signState(payload: Record<string, string>): string {
  const body = Buffer.from(
    JSON.stringify({ ...payload, t: Date.now() }),
  ).toString("base64url");
  const mac = createHmac("sha256", secret()).update(body).digest("base64url");
  return `${body}.${mac}`;
}

export function verifyState(
  state: string,
  maxAgeMs = 15 * 60 * 1000,
): Record<string, string> | null {
  const [body, mac] = state.split(".");
  if (!body || !mac) return null;

  const expected = createHmac("sha256", secret()).update(body).digest("base64url");
  const given = Buffer.from(mac);
  const want = Buffer.from(expected);
  if (given.length !== want.length || !timingSafeEqual(given, want)) return null;

  try {
    const parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (typeof parsed.t !== "number" || Date.now() - parsed.t > maxAgeMs) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

/** Absolute origin of this deployment, for OAuth redirect URIs. */
export function appOrigin(request?: Request): string {
  const configured = process.env.APP_ORIGIN || process.env.NEXT_PUBLIC_APP_ORIGIN;
  if (configured) return configured.replace(/\/$/, "");
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  }
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  if (request) return new URL(request.url).origin;
  return "http://localhost:3000";
}

export function redirectUri(
  provider: "google" | "microsoft" | "spotify",
  request?: Request,
): string {
  return `${appOrigin(request)}/api/auth/${provider}/callback`;
}
