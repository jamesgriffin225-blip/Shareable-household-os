import { getConnection, updateTokens } from "@/lib/connections";
import {
  fetchNowPlaying,
  refreshSpotifyToken,
  scopeHasNowPlaying,
  spotifyOauthConfigured,
} from "@/lib/spotify";
import { handle, json, requireProfile } from "@/lib/http";

export const dynamic = "force-dynamic";

/**
 * What is playing, for the mini player.
 *
 * Every unhappy answer is a 200 with a reason rather than an error status: the
 * caller polls this every few seconds and a red banner for "nothing is
 * playing" would be absurd.
 */
export async function GET(request: Request) {
  try {
    if (!spotifyOauthConfigured()) return json({ available: false, track: null });

    const profileId = await requireProfile(request).catch(() => null);
    const connection = profileId ? await getConnection(profileId, "spotify") : null;
    if (!connection) return json({ available: false, track: null });

    // The scope arrived later than the integration did, so a connection made
    // before it exists and works for everything except this.
    if (!scopeHasNowPlaying(connection.scope)) {
      return json({ available: false, reconnect: true, track: null });
    }

    let token = connection.accessToken;
    const stale =
      !token ||
      !connection.expiresAt ||
      connection.expiresAt.getTime() - Date.now() < 60_000;

    if (stale) {
      if (!connection.refreshToken) return json({ available: false, track: null });
      const refreshed = await refreshSpotifyToken(connection.refreshToken);
      token = refreshed.accessToken;
      await updateTokens(
        connection.id,
        refreshed.accessToken,
        refreshed.expiresAt,
        refreshed.refreshToken,
      );
    }

    return json({ available: true, track: await fetchNowPlaying(token!) });
  } catch (error) {
    return handle(error);
  }
}
