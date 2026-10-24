import { NextResponse } from "next/server";
import { saveConnection } from "@/lib/connections";
import { exchangeSpotifyCode } from "@/lib/spotify";
import { appOrigin, redirectUri, verifyState } from "@/lib/oauth";
import { handle } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const state = url.searchParams.get("state");
    const claims = state ? verifyState(state) : null;

    // Back to wherever the button was pressed: Settings, or the wall's Music
    // tab. Each reads its own query parameter for how it went.
    const toSettings = claims?.from === "settings";
    const back = (outcome: "ok" | string) =>
      NextResponse.redirect(
        toSettings
          ? `${appOrigin(request)}/settings?${
              outcome === "ok" ? "connected=Spotify" : `error=${encodeURIComponent(`Spotify: ${outcome}`)}`
            }`
          : `${appOrigin(request)}/dashboard?spotify=${encodeURIComponent(
              outcome === "ok" ? "connected" : outcome,
            )}`,
      );

    const error = url.searchParams.get("error");
    if (error) return back(error);

    const code = url.searchParams.get("code");
    if (!code || !state) return back("missing_code");
    if (!claims?.profileId) return back("bad_state");

    const token = await exchangeSpotifyCode(code, redirectUri("spotify", request));
    await saveConnection({
      profileId: claims.profileId,
      provider: "spotify",
      accountEmail: null,
      accessToken: token.accessToken,
      refreshToken: token.refreshToken,
      expiresAt: token.expiresAt,
      scope: token.scope,
    });

    return back("ok");
  } catch (error) {
    return handle(error);
  }
}
