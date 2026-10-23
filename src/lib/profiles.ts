import { sql } from "./db.ts";
import type { Profile } from "./types.ts";

export async function listProfiles(): Promise<Profile[]> {
  const rows = await sql<{ id: string; name: string; color: string }>(
    "select id, name, color from profiles order by position, name",
  );
  return rows;
}

export async function profileExists(id: string): Promise<boolean> {
  const rows = await sql("select 1 from profiles where id = $1", [id]);
  return rows.length > 0;
}

/**
 * Match a spoken name ("put it on Sarah's calendar") to a profile. Deliberately
 * forgiving on first names and possessives; returns null rather than guessing
 * between two people.
 */
export function matchProfile(profiles: Profile[], name?: string | null): Profile | null {
  if (!name) return null;
  const needle = name.trim().toLowerCase().replace(/'s$/, "");
  if (!needle) return null;

  const exact = profiles.find((profile) => profile.name.toLowerCase() === needle);
  if (exact) return exact;

  const byFirstName = profiles.filter(
    (profile) => profile.name.toLowerCase().split(/\s+/)[0] === needle.split(/\s+/)[0],
  );
  if (byFirstName.length === 1) return byFirstName[0];

  const byId = profiles.find((profile) => profile.id === needle);
  return byId ?? null;
}
