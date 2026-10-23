import assert from "node:assert/strict";
import { test } from "node:test";
import { matchProfile } from "../src/lib/profiles.ts";
import { slug } from "../src/lib/db.ts";

const people = [
  { id: "alex", name: "Alex", color: "#e8834a" },
  { id: "sarah", name: "Sarah", color: "#5aa9c4" },
];

test("a spoken name finds the right calendar", () => {
  assert.equal(matchProfile(people, "Sarah")?.id, "sarah");
  assert.equal(matchProfile(people, "sarah")?.id, "sarah");
  assert.equal(matchProfile(people, "Sarah's")?.id, "sarah");
});

test("no name means no guess", () => {
  assert.equal(matchProfile(people, null), null);
  assert.equal(matchProfile(people, ""), null);
  assert.equal(matchProfile(people, "the kids"), null);
});

test("profile ids are url-safe", () => {
  assert.equal(slug("Alex"), "alex");
  assert.equal(slug("Mary-Anne O'Brien"), "mary-anne-o-brien");
  assert.equal(slug("!!!"), "person");
});
