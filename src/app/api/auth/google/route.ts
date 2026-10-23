import { NextResponse } from "next/server";
import { googleAuthUrl, googleConfigured } from "@/lib/google";
import { signState } from "@/lib/oauth";
import { fail, handle, requireProfile } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    if (!googleConfigured()) {
      return fail("GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are not set", 503);
    }
    const profileId = await requireProfile(request);
    return NextResponse.redirect(
      googleAuthUrl(signState({ profileId, provider: "google" }), request),
    );
  } catch (error) {
    return handle(error);
  }
}
