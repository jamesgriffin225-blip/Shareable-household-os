import { NextResponse, type NextRequest } from "next/server";

/**
 * One passcode for the household.
 *
 * There is no per-person login by design — two people in one house don't need
 * accounts. But a Vercel URL is a public URL, and behind it are two calendars,
 * four inboxes' worth of extracted detail and the renovation budget. So: one
 * shared passcode, entered once per device, held in a cookie. Leave
 * HOUSEHOLD_PASSCODE unset and the gate is off, which is what you want locally.
 */
const OPEN_PATHS = [
  "/unlock",
  "/api/unlock",
  "/api/cron/", // guarded by CRON_SECRET instead
  "/api/auth/", // OAuth callbacks carry their own signed state
  "/icons/",
  "/sw.js",
  "/capture.webmanifest",
  "/dashboard.webmanifest",
  "/favicon.ico",
];

export const COOKIE = "household_key";

export async function passKey(passcode: string, secret: string): Promise<string> {
  const data = new TextEncoder().encode(`${passcode}:${secret}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function middleware(request: NextRequest) {
  const passcode = process.env.HOUSEHOLD_PASSCODE;
  if (!passcode) return NextResponse.next();

  const { pathname, search } = request.nextUrl;
  if (OPEN_PATHS.some((path) => pathname === path || pathname.startsWith(path))) {
    return NextResponse.next();
  }

  const expected = await passKey(passcode, process.env.APP_SECRET || "household");
  if (request.cookies.get(COOKIE)?.value === expected) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Locked" }, { status: 401 });
  }

  const url = request.nextUrl.clone();
  url.pathname = "/unlock";
  url.search = `?next=${encodeURIComponent(pathname + search)}`;
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
