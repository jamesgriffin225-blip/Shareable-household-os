import { addStation, listStations, removeStation } from "@/lib/music";
import { embedPath, seedStations, spotifyOauthConfigured } from "@/lib/spotify";
import { getConnection } from "@/lib/connections";
import { fail, handle, json, readJson, requireProfile } from "@/lib/http";

export const dynamic = "force-dynamic";

/**
 * The pinned playlists.
 *
 * On an empty table the SPOTIFY_STATIONS env var seeds it once, so an install
 * that was configured the old way keeps working and then never needs the file
 * again.
 */
export async function GET(request: Request) {
  try {
    let saved = await listStations();
    if (saved.length === 0) {
      for (const seed of seedStations()) {
        await addStation({ name: seed.name, path: seed.path });
      }
      saved = await listStations();
    }

    // Whether the picker can be offered at all, and to whom.
    const profileId = await requireProfile(request).catch(() => null);
    const connection = profileId ? await getConnection(profileId, "spotify") : null;

    return json({
      configured: saved.length > 0,
      stations: saved,
      oauth: spotifyOauthConfigured(),
      connected: Boolean(connection),
    });
  } catch (error) {
    return handle(error);
  }
}

export async function POST(request: Request) {
  try {
    const body = await readJson<{
      name?: string;
      link?: string;
      path?: string;
      imageUrl?: string | null;
      profileId?: string;
    }>(request);
    const profileId = await requireProfile(request, body);

    // A link pasted by hand and a row tapped in the picker arrive here the
    // same way; only one of them has already been normalised.
    const path = body.path ?? embedPath(body.link ?? "");
    if (!path) return fail("That doesn't look like a Spotify link", 400);
    if (!body.name?.trim()) return fail("Give it a name", 400);

    return json({
      station: await addStation({
        name: body.name,
        path,
        imageUrl: body.imageUrl ?? null,
        addedBy: profileId,
      }),
    });
  } catch (error) {
    return handle(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const id = new URL(request.url).searchParams.get("id");
    if (!id) return fail("Which playlist?", 400);
    await removeStation(id);
    return json({ ok: true });
  } catch (error) {
    return handle(error);
  }
}
