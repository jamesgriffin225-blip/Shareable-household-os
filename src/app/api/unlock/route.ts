import { NextResponse } from "next/server";
import { COOKIE, passKey } from "@/middleware";
import { fail, readJson } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const passcode = process.env.HOUSEHOLD_PASSCODE;
  if (!passcode) return NextResponse.json({ ok: true });

  const body = await readJson<{ passcode?: string }>(request);
  if ((body.passcode ?? "").trim() !== passcode) {
    // No timing games here: a four-digit family passcode on a private URL is
    // not the thing an attacker would go after.
    return fail("That's not it", 401);
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set({
    name: COOKIE,
    value: await passKey(passcode, process.env.APP_SECRET || "household"),
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  return response;
}
