import { exec, one, sql } from "./db.ts";

/**
 * The playlists pinned to the Music tab.
 *
 * In Postgres rather than an environment variable, because adding music to the
 * kitchen wall should not involve editing a file and restarting a server. The
 * env var remains only as a way to seed a fresh install.
 */

export interface Station {
  id: string;
  name: string;
  /** `playlist/37i9dQ...` — the kind and the id, ready for the embed. */
  path: string;
  imageUrl: string | null;
  position: number;
  addedBy: string | null;
}

type Row = {
  id: string;
  name: string;
  path: string;
  image_url: string | null;
  position: number | string;
  added_by: string | null;
};

const COLUMNS = "id, name, path, image_url, position, added_by";

function toStation(row: Row): Station {
  return {
    id: String(row.id),
    name: row.name,
    path: row.path,
    imageUrl: row.image_url,
    position: Number(row.position),
    addedBy: row.added_by,
  };
}

export async function listStations(): Promise<Station[]> {
  const rows = await sql<Row>(
    `select ${COLUMNS} from music_stations order by position, created_at`,
  );
  return rows.map(toStation);
}

export async function addStation(input: {
  name: string;
  path: string;
  imageUrl?: string | null;
  addedBy?: string | null;
}): Promise<Station> {
  // Re-adding something already pinned renames it rather than failing or
  // quietly doing nothing — which is what pressing the button twice means.
  const row = await one<Row>(
    `insert into music_stations (name, path, image_url, added_by, position)
     values ($1, $2, $3, $4,
       coalesce((select max(position) + 1 from music_stations), 0))
     on conflict (path) do update
       set name = excluded.name, image_url = excluded.image_url
     returning ${COLUMNS}`,
    [input.name.trim().slice(0, 80), input.path, input.imageUrl ?? null, input.addedBy ?? null],
  );
  if (!row) throw new Error("Could not save that playlist");
  return toStation(row);
}

export async function removeStation(id: string): Promise<void> {
  await exec("delete from music_stations where id = $1", [id]);
}
