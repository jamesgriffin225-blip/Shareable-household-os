import { Pool, types } from "pg";
import { SCHEMA_SQL } from "./schema.generated.ts";

// numeric comes back as a string by default so big values don't lose precision.
// Every numeric in this schema is a household-sized dollar amount.
types.setTypeParser(1700, (value) => Number.parseFloat(value));

export class NotConfiguredError extends Error {
  constructor(what: string) {
    super(`${what} is not configured`);
    this.name = "NotConfiguredError";
  }
}

function connectionString(): string {
  const url =
    process.env.DATABASE_URL ||
    process.env.POSTGRES_URL ||
    process.env.POSTGRES_PRISMA_URL ||
    "";
  if (!url) throw new NotConfiguredError("DATABASE_URL");
  return url;
}

export function databaseConfigured(): boolean {
  return Boolean(
    process.env.DATABASE_URL ||
      process.env.POSTGRES_URL ||
      process.env.POSTGRES_PRISMA_URL,
  );
}

// The pool and the migration both have to survive hot reloads in dev and be
// shared between serverless invocations that land on the same instance.
const globalForDb = globalThis as unknown as {
  __householdPool?: Pool;
  __householdMigration?: Promise<void>;
};

function pool(): Pool {
  if (!globalForDb.__householdPool) {
    const url = connectionString();
    const local = /@(localhost|127\.0\.0\.1)[:/]/.test(url);
    globalForDb.__householdPool = new Pool({
      connectionString: url,
      // Serverless: many short-lived instances, so keep each one's footprint
      // small rather than holding connections the next invocation won't reuse.
      max: Number(process.env.PGPOOL_MAX || 3),
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 10_000,
      ssl: local ? undefined : { rejectUnauthorized: false },
    });
    globalForDb.__householdPool.on("error", (err) => {
      console.error("[db] idle client error", err);
    });
  }
  return globalForDb.__householdPool;
}

async function migrate(): Promise<void> {
  if (!globalForDb.__householdMigration) {
    globalForDb.__householdMigration = (async () => {
      await pool().query(SCHEMA_SQL);
      await seedProfiles();
    })().catch((err) => {
      // A failed migration must not be cached as "done" — the next request
      // should get a fresh attempt rather than a permanently broken app.
      globalForDb.__householdMigration = undefined;
      throw err;
    });
  }
  return globalForDb.__householdMigration;
}

async function seedProfiles(): Promise<void> {
  const { rows } = await pool().query<{ count: string }>(
    "select count(*)::text as count from profiles",
  );
  if (Number(rows[0].count) > 0) return;

  const configured = (process.env.HOUSEHOLD_PROFILES || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  const names = configured.length === 2 ? configured : ["Alex", "Partner"];
  const colors = ["#bd5a24", "#1f7590"];

  for (const [index, name] of names.entries()) {
    await pool().query(
      `insert into profiles (id, name, color, position)
       values ($1, $2, $3, $4)
       on conflict (id) do nothing`,
      [slug(name), name, colors[index] ?? "#8a8f98", index],
    );
  }
}

export function slug(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "person"
  );
}

/** Run a query, migrating the schema on first use in this instance. */
export async function sql<T extends Record<string, any> = Record<string, any>>(
  text: string,
  params: readonly unknown[] = [],
): Promise<T[]> {
  await migrate();
  const result = await pool().query<T>(text, params as unknown[]);
  return result.rows;
}

/** Same, for a statement whose rows we don't need. */
export async function exec(
  text: string,
  params: readonly unknown[] = [],
): Promise<number> {
  await migrate();
  const result = await pool().query(text, params as unknown[]);
  return result.rowCount ?? 0;
}

export async function one<T extends Record<string, any>>(
  text: string,
  params: readonly unknown[] = [],
): Promise<T | null> {
  const rows = await sql<T>(text, params);
  return rows[0] ?? null;
}

/** Read a JSON blob from the shared scratch table. */
export async function getState<T>(key: string): Promise<{ value: T; updatedAt: Date } | null> {
  const row = await one<{ value: T; updated_at: Date }>(
    "select value, updated_at from app_state where key = $1",
    [key],
  );
  return row ? { value: row.value, updatedAt: row.updated_at } : null;
}

export async function setState(key: string, value: unknown): Promise<void> {
  await exec(
    `insert into app_state (key, value, updated_at) values ($1, $2, now())
     on conflict (key) do update set value = excluded.value, updated_at = now()`,
    [key, JSON.stringify(value)],
  );
}
