import { NextResponse } from "next/server";
import { getConnection, saveConnection } from "@/lib/connections";
import { exchangeMicrosoftCode, microsoftAccountEmail } from "@/lib/microsoft";
import { appOrigin, verifyState } from "@/lib/oauth";
import { handle } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const settings = `${appOrigin(request)}/settings`;

    const error = url.searchParams.get("error");
    if (error) {
      return NextResponse.redirect(`${settings}?error=${encodeURIComponent(error)}`);
    }

    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    if (!code || !state) return NextResponse.redirect(`${settings}?error=missing_code`);

    const claims = verifyState(state);
    if (!claims?.profileId) return NextResponse.redirect(`${settings}?error=bad_state`);

    const token = await exchangeMicrosoftCode(code, request);
    await saveConnection({
      profileId: claims.profileId,
      provider: "microsoft",
      accountEmail: null,
      accessToken: token.accessToken,
      refreshToken: token.refreshToken,
      expiresAt: token.expiresAt,
      scope: token.scope,
    });

    // Graph doesn't return the address in the token, so ask for it now that
    // the connection exists — it's what identifies the mailbox in Settings.
    const saved = await getConnection(claims.profileId, "microsoft");
    if (saved) {
      const email = await microsoftAccountEmail(saved).catch(() => null);
      if (email) {
        await saveConnection({
          profileId: claims.profileId,
          provider: "microsoft",
          accountEmail: email,
          accessToken: token.accessToken,
          refreshToken: token.refreshToken,
          expiresAt: token.expiresAt,
          scope: token.scope,
        });
      }
    }

    return NextResponse.redirect(`${settings}?connected=microsoft`);
  } catch (error) {
    return handle(error);
  }
}
