import assert from "node:assert/strict";
import { test } from "node:test";
import {
  addDayKeys,
  addMonthKeys,
  dayKeysIn,
  DAYS_AHEAD,
  DAYS_BEHIND,
  endOfMonthKey,
  openingDay,
  periodLabel,
  rangeLabel,
  shiftAnchor,
  shiftPeriod,
  startOfWeekKey,
  viewRange,
  visibleRange,
  VISIBLE_DAYS,
} from "../src/components/Dashboard/calendar-range.ts";

test("a week still runs Monday to Sunday, for the money tile", () => {
  // 2026-09-10 is a Thursday. The day strip no longer uses this, but spending
  // "this week" does, and it means the same thing it always did.
  assert.equal(startOfWeekKey("2026-09-10"), "2026-09-07");
  assert.equal(startOfWeekKey("2026-09-07"), "2026-09-07");
  assert.equal(startOfWeekKey("2026-09-13"), "2026-09-07");
});

test("the strip opens two days back and four forward", () => {
  // What the wall is asked is "what is on today, and what is coming" -- a
  // Monday-to-Sunday grid spends five of its seven columns on the past by
  // Sunday afternoon.
  assert.equal(openingDay("2026-09-10"), "2026-09-08");
  assert.deepEqual(visibleRange(openingDay("2026-09-10")), {
    from: "2026-09-08",
    to: "2026-09-14",
  });
  assert.equal(VISIBLE_DAYS, 7, "still seven columns, just offset");
  assert.equal(DAYS_BEHIND + DAYS_AHEAD + 1, VISIBLE_DAYS);
});

test("the strip fetches far wider than it shows, so scrolling is free", () => {
  const fetched = viewRange("days", "2026-09-10");
  assert.deepEqual(fetched, { from: "2026-08-27", to: "2026-10-08" });
  const shown = dayKeysIn(visibleRange(openingDay("2026-09-10")));
  const held = dayKeysIn(fetched);
  // Everything on screen is inside what was fetched, with room either side.
  assert.ok(shown.every((key) => held.includes(key)));
  assert.ok(held.length > shown.length * 4);
});

test("a month view covers whole weeks, spilling either side", () => {
  // September 2026 starts on a Tuesday and ends on a Wednesday, so the grid
  // reaches back to 31 August and forward to 4 October.
  assert.deepEqual(viewRange("month", "2026-09-10"), {
    from: "2026-08-31",
    to: "2026-10-04",
  });
  assert.equal(dayKeysIn(viewRange("month", "2026-09-10")).length, 35);
});

test("month arithmetic never lands on a day that does not exist", () => {
  assert.equal(addMonthKeys("2026-03-31", -1), "2026-02-28");
  assert.equal(addMonthKeys("2026-01-31", 1), "2026-02-28");
  assert.equal(addMonthKeys("2024-01-31", 1), "2024-02-29");
  assert.equal(addMonthKeys("2026-12-15", 1), "2027-01-15");
});

test("stepping moves by the unit the view is made of", () => {
  assert.equal(shiftAnchor("days", "2026-09-10", 1), "2026-09-17");
  assert.equal(shiftAnchor("days", "2026-09-10", -2), "2026-08-27");
  assert.equal(shiftAnchor("month", "2026-09-10", 1), "2026-10-10");
});

test("the money tile pages its own periods, not the calendar's", () => {
  // These were the same function while the calendar happened to be a week.
  // They are different questions and now have different types.
  assert.equal(shiftPeriod("week", "2026-09-10", 1), "2026-09-17");
  assert.equal(shiftPeriod("month", "2026-09-10", 1), "2026-10-10");
  assert.equal(periodLabel("week", "2026-09-10"), "7 – 13 Sept");
  assert.equal(periodLabel("month", "2026-09-10"), "September 2026");
});

test("day arithmetic crosses months and years", () => {
  assert.equal(addDayKeys("2026-08-31", 1), "2026-09-01");
  assert.equal(addDayKeys("2026-12-31", 1), "2027-01-01");
  assert.equal(addDayKeys("2026-01-01", -1), "2025-12-31");
  assert.equal(endOfMonthKey("2024-02-10"), "2024-02-29");
});

test("labels name the month, or the span, and repeat the month only when it changes", () => {
  assert.equal(rangeLabel("month", "2026-09-10"), "September 2026");
  // The strip's label describes what is ON SCREEN, so it takes the leftmost
  // visible day -- the anchor names a range four times wider.
  assert.equal(rangeLabel("days", "2026-09-07"), "7 – 13 Sept");
  // A span that straddles two months has to name both.
  assert.equal(rangeLabel("days", "2026-08-31"), "31 Aug – 6 Sept");
});

test("a range that straddles new year carries the year", () => {
  assert.equal(rangeLabel("days", "2026-12-28"), "28 Dec 2026 – 3 Jan 2027");
  assert.equal(periodLabel("week", "2026-12-31"), "28 Dec 2026 – 3 Jan 2027");
});
