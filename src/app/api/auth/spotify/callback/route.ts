import { NextResponse } from "next/server";
import { saveConnection } from "@/lib/connections";
import { exchangeSpotifyCode } from "@/lib/spotify";
import { appOrigin, redirectUri, verifyState } from "@/lib/oauth";
import { handle } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    // Back to the wall, not to Settings: this is started from the Music tab.
    const done = `${appOrigin(request)}/dashboard`;

    const error = url.searchParams.get("error");
    if (error) return NextResponse.redirect(`${done}?spotify=${encodeURIComponent(error)}`);

    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    if (!code || !state) return NextResponse.redirect(`${done}?spotify=missing_code`);

    const claims = verifyState(state);
    if (!claims?.profileId) return NextResponse.redirect(`${done}?spotify=bad_state`);

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

    return NextResponse.redirect(`${done}?spotify=connected`);
  } catch (error) {
    return handle(error);
  }
}
