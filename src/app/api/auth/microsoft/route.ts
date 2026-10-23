import { NextResponse } from "next/server";
import { microsoftAuthUrl, microsoftConfigured } from "@/lib/microsoft";
import { signState } from "@/lib/oauth";
import { fail, handle, requireProfile } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    if (!microsoftConfigured()) {
      return fail("MICROSOFT_CLIENT_ID / MICROSOFT_CLIENT_SECRET are not set", 503);
    }
    const profileId = await requireProfile(request);
    return NextResponse.redirect(
      microsoftAuthUrl(signState({ profileId, provider: "microsoft" }), request),
    );
  } catch (error) {
    return handle(error);
  }
}
