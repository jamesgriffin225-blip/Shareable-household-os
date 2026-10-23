import { getConnection, updateTokens } from "@/lib/connections";
import { fetchLibrary, refreshSpotifyToken, spotifyOauthConfigured } from "@/lib/spotify";
import { fail, handle, json, requireProfile } from "@/lib/http";

export const dynamic = "force-dynamic";

/** The playlists this person already has, for the picker. */
export async function GET(request: Request) {
  try {
    if (!spotifyOauthConfigured()) return fail("Spotify is not set up", 503);
    const profileId = await requireProfile(request);
    const connection = await getConnection(profileId, "spotify");
    if (!connection) return fail("Spotify is not connected", 401);

    let token = connection.accessToken;
    const stale =
      !token ||
      !connection.expiresAt ||
      connection.expiresAt.getTime() - Date.now() < 60_000;

    if (stale) {
      if (!connection.refreshToken) return fail("Reconnect Spotify", 401);
      const refreshed = await refreshSpotifyToken(connection.refreshToken);
      token = refreshed.accessToken;
      await updateTokens(
        connection.id,
        refreshed.accessToken,
        refreshed.expiresAt,
        refreshed.refreshToken,
      );
    }

    return json({ playlists: await fetchLibrary(token!) });
  } catch (error) {
    return handle(error);
  }
}
