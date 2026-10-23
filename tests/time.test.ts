import assert from "node:assert/strict";
import { test } from "node:test";
import {
  addDays,
  dateKey,
  describeMoment,
  fromWallClock,
  isDateOnly,
  startOfWeek,
  zoneOffsetMs,
} from "../src/lib/time.ts";

const BRIS = "Australia/Brisbane";
const SYD = "Australia/Sydney";

test("a wall clock resolves against the household zone, not the server's", () => {
  // Brisbane never observes daylight saving: always UTC+10.
  const instant = fromWallClock("2026-09-10T18:00", BRIS)!;
  assert.equal(instant.toISOString(), "2026-09-10T08:00:00.000Z");
});

test("a bare date is midnight in the household zone", () => {
  const instant = fromWallClock("2026-09-10", BRIS)!;
  assert.equal(instant.toISOString(), "2026-09-09T14:00:00.000Z");
});

test("an explicit offset wins over the household zone", () => {
  const instant = fromWallClock("2026-09-10T18:00:00Z", BRIS)!;
  assert.equal(instant.toISOString(), "2026-09-10T18:00:00.000Z");
});

test("daylight saving is handled on both sides of the change", () => {
  // Sydney moves to UTC+11 at 2am on the first Sunday of October.
  const before = fromWallClock("2026-10-03T12:00", SYD)!;
  const after = fromWallClock("2026-10-05T12:00", SYD)!;
  assert.equal(zoneOffsetMs(before, SYD), 10 * 3_600_000);
  assert.equal(zoneOffsetMs(after, SYD), 11 * 3_600_000);
  assert.equal(before.toISOString(), "2026-10-03T02:00:00.000Z");
  assert.equal(after.toISOString(), "2026-10-05T01:00:00.000Z");
});

test("a wall clock inside the skipped hour still lands somewhere real", () => {
  // 2:30am on the changeover day does not exist in Sydney.
  const instant = fromWallClock("2026-10-04T02:30", SYD);
  assert.ok(instant instanceof Date);
  assert.ok(!Number.isNaN(instant!.getTime()));
});

test("garbage in gives null, not an Invalid Date that reaches Google", () => {
  assert.equal(fromWallClock("sometime next week", BRIS), null);
  assert.equal(fromWallClock("", BRIS), null);
});

test("date-only detection distinguishes all-day events", () => {
  assert.equal(isDateOnly("2026-09-10"), true);
  assert.equal(isDateOnly("2026-09-10T09:00"), false);
});

test("the week starts on Monday in household time", () => {
  const thursday = fromWallClock("2026-09-10T09:00", BRIS)!;
  const monday = startOfWeek(thursday, BRIS);
  assert.equal(dateKey(monday, BRIS), "2026-09-07");
  assert.equal(dateKey(addDays(monday, 6), BRIS), "2026-09-13");
});

test("a Sunday belongs to the week that just ended", () => {
  const sunday = fromWallClock("2026-09-13T21:00", BRIS)!;
  assert.equal(dateKey(startOfWeek(sunday, BRIS), BRIS), "2026-09-07");
});

test("confirmations read like a person wrote them", () => {
  const when = describeMoment("2026-09-10T16:00", { timeZone: BRIS });
  assert.match(when, /Thu/);
  assert.match(when, /4:00 pm/i);
  // The month abbreviation is ICU's ("Sept" in en-AU); assert the shape, not
  // a spelling that varies by Node build.
  assert.match(
    describeMoment("2026-09-10", { allDay: true, timeZone: BRIS }),
    /^Thu,? 10 Sept?$/,
  );
});
