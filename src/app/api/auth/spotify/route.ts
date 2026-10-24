import { NextResponse } from "next/server";
import { spotifyAuthUrl, spotifyOauthConfigured } from "@/lib/spotify";
import { redirectUri, signState } from "@/lib/oauth";
import { fail, handle, requireProfile } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    if (!spotifyOauthConfigured()) {
      return fail("SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET are not set", 503);
    }
    const profileId = await requireProfile(request);
    // Settings and the Music tab both start this; each wants the person back
    // where they pressed the button. Carried in the signed state, so the
    // callback cannot be pointed anywhere else.
    const from = new URL(request.url).searchParams.get("from") === "settings" ? "settings" : "dashboard";
    return NextResponse.redirect(
      spotifyAuthUrl(
        signState({ profileId, provider: "spotify", from }),
        redirectUri("spotify", request),
      ),
    );
  } catch (error) {
    return handle(error);
  }
}
