import assert from "node:assert/strict";
import { test } from "node:test";
import { embedPath, parseStations } from "../src/lib/spotify.ts";

test("the three things a person actually has to hand all resolve", () => {
  // The right-click "Copy Spotify URI" from the desktop app.
  assert.equal(
    embedPath("spotify:playlist:37i9dQZF1DXcBWIGoYBM5M"),
    "playlist/37i9dQZF1DXcBWIGoYBM5M",
  );
  // The share link, tracking parameter and all.
  assert.equal(
    embedPath("https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M?si=abc123"),
    "playlist/37i9dQZF1DXcBWIGoYBM5M",
  );
  // The embed URL, for anyone who went looking for one first.
  assert.equal(
    embedPath("https://open.spotify.com/embed/album/4aawyAB9vmqN3uQ7FjRGTy"),
    "album/4aawyAB9vmqN3uQ7FjRGTy",
  );
});

test("Spotify's localised share links resolve too", () => {
  assert.equal(
    embedPath("https://open.spotify.com/intl-de/track/4cOdK2wGLETKBW3PvgPWqT"),
    "track/4cOdK2wGLETKBW3PvgPWqT",
  );
});

test("anything that is not a Spotify thing is refused, not guessed at", () => {
  assert.equal(embedPath(""), null);
  assert.equal(embedPath("   "), null);
  assert.equal(embedPath("https://music.apple.com/playlist/abc"), null);
  assert.equal(embedPath("spotify:nonsense:37i9dQZF1DXcBWIGoYBM5M"), null);
  assert.equal(embedPath("spotify:playlist:short"), null);
  assert.equal(embedPath("javascript:alert(1)"), null);
});

test("stations keep their order and their names", () => {
  const stations = parseStations(
    "Kitchen=spotify:playlist:37i9dQZF1DXcBWIGoYBM5M," +
      "Dinner=https://open.spotify.com/album/4aawyAB9vmqN3uQ7FjRGTy",
  );
  assert.deepEqual(stations, [
    { name: "Kitchen", path: "playlist/37i9dQZF1DXcBWIGoYBM5M" },
    { name: "Dinner", path: "album/4aawyAB9vmqN3uQ7FjRGTy" },
  ]);
});

test("an entry that cannot be read is dropped, and the rest still work", () => {
  const stations = parseStations(
    "Broken=not-a-link,Kitchen=spotify:playlist:37i9dQZF1DXcBWIGoYBM5M,=spotify:playlist:37i9dQZF1DXcBWIGoYBM5M",
  );
  assert.deepEqual(stations, [
    { name: "Kitchen", path: "playlist/37i9dQZF1DXcBWIGoYBM5M" },
  ]);
  assert.deepEqual(parseStations(undefined), []);
});

import { readLibrary } from "../src/lib/spotify.ts";

test("a Spotify playlist page reduces to what the picker shows", () => {
  const items = readLibrary({
    items: [
      {
        name: "Kitchen",
        uri: "spotify:playlist:37i9dQZF1DXcBWIGoYBM5M",
        images: [{ url: "https://i.scdn.co/image/abc" }],
        tracks: { total: 64 },
        owner: { display_name: "Alex" },
      },
      // A podcast show has no embeddable playlist path here; and an item with
      // neither uri nor link is not something to guess at.
      { name: "Broken", tracks: { total: 3 } },
    ],
  });
  assert.deepEqual(items, [
    {
      name: "Kitchen",
      path: "playlist/37i9dQZF1DXcBWIGoYBM5M",
      imageUrl: "https://i.scdn.co/image/abc",
      tracks: 64,
      owner: "Alex",
    },
  ]);
});

test("a playlist with no artwork still lists", () => {
  const items = readLibrary({
    items: [{ name: "Bare", uri: "spotify:playlist:37i9dQZF1DXcBWIGoYBM5M", images: [] }],
  });
  assert.equal(items[0].imageUrl, null);
  assert.equal(items[0].tracks, 0);
  assert.equal(items[0].owner, null);
});

test("an empty or missing page is empty, not an error", () => {
  assert.deepEqual(readLibrary({}), []);
  assert.deepEqual(readLibrary(null), []);
});

import { readNowPlaying, scopeHasNowPlaying } from "../src/lib/spotify.ts";

test("a playing track reduces to what the mini player shows", () => {
  const track = readNowPlaying({
    is_playing: true,
    progress_ms: 62000,
    item: {
      name: "Wide Open Road",
      duration_ms: 245000,
      artists: [{ name: "The Triffids" }],
      album: { name: "Born Sandy Devotional", images: [{ url: "https://i.scdn.co/x" }] },
    },
  });
  assert.deepEqual(track, {
    title: "Wide Open Road",
    artist: "The Triffids",
    album: "Born Sandy Devotional",
    imageUrl: "https://i.scdn.co/x",
    playing: true,
    progressMs: 62000,
    durationMs: 245000,
  });
});

test("several artists are joined, and a paused track says so", () => {
  const track = readNowPlaying({
    is_playing: false,
    item: { name: "Duet", artists: [{ name: "One" }, { name: "Two" }], album: {} },
  });
  assert.equal(track?.artist, "One, Two");
  assert.equal(track?.playing, false);
  assert.equal(track?.imageUrl, null);
});

test("nothing playing is null, not an empty track", () => {
  assert.equal(readNowPlaying(null), null);
  assert.equal(readNowPlaying({}), null);
  assert.equal(readNowPlaying({ is_playing: true, item: {} }), null);
});

test("a connection made before the scope existed is detected", () => {
  assert.equal(scopeHasNowPlaying("playlist-read-private"), false);
  assert.equal(
    scopeHasNowPlaying("playlist-read-private user-read-currently-playing"),
    true,
  );
  assert.equal(scopeHasNowPlaying(null), false);
});
