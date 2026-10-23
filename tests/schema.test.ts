import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { SCHEMA_SQL } from "../src/lib/schema.generated.ts";

test("the generated schema module matches db/schema.sql", () => {
  const source = readFileSync(new URL("../db/schema.sql", import.meta.url), "utf8");
  assert.equal(
    SCHEMA_SQL,
    source,
    "run `node scripts/build-schema.mjs` after editing db/schema.sql",
  );
});

test("every table is created idempotently, because it runs on every cold start", () => {
  const creates = SCHEMA_SQL.match(/create table[^(]*/gi) ?? [];
  assert.ok(creates.length > 5);
  for (const statement of creates) {
    assert.match(statement, /if not exists/i, `not idempotent: ${statement.trim()}`);
  }
  for (const statement of SCHEMA_SQL.match(/create index[^(]*/gi) ?? []) {
    assert.match(statement, /if not exists/i, `not idempotent: ${statement.trim()}`);
  }
});

test("the calendar is not cached in Postgres", () => {
  assert.doesNotMatch(SCHEMA_SQL, /create table if not exists (calendar|events)\b/i);
});
