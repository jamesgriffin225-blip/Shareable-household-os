import assert from "node:assert/strict";
import { test } from "node:test";
import { eventKey, splitEventKey } from "../src/lib/google.ts";
import { groupAgenda } from "../src/components/Dashboard/agenda.ts";
import type { CalendarEvent } from "../src/lib/types.ts";

const TZ = "Australia/Brisbane";

// Brisbane is UTC+10 all year, so 04:00Z is 14:00 on the same day.
const NOW = new Date("2026-09-10T04:00:00Z"); // Thursday, 2pm

function event(partial: Partial<CalendarEvent> & { id: string }): CalendarEvent {
  return {
    profileId: "alex",
    title: "Something",
    start: "2026-09-10T00:00:00Z",
    end: "2026-09-10T01:00:00Z",
    allDay: false,
    location: null,
    notes: null,
    htmlLink: null,
    ...partial,
  };
}

test("keeps today even when nothing is on, and drops other empty days", () => {
  const days = groupAgenda([], { now: NOW, timeZone: TZ });
  assert.equal(days.length, 1);
  assert.equal(days[0].label, "Today");
  assert.equal(days[0].events.length, 0);
});

test("labels the first two days by name and the rest by date", () => {
  const days = groupAgenda(
    [
      event({ id: "a", start: "2026-09-11T00:00:00Z", end: "2026-09-11T01:00:00Z" }),
      event({ id: "b", start: "2026-09-13T00:00:00Z", end: "2026-09-13T01:00:00Z" }),
    ],
    { now: NOW, timeZone: TZ },
  );
  assert.deepEqual(
    days.map((day) => day.label),
    ["Today", "Tomorrow", "Sun 13 Sept"],
  );
});

test("sorts all-day events above timed ones, then by start", () => {
  const days = groupAgenda(
    [
      event({ id: "late", start: "2026-09-10T08:00:00Z", end: "2026-09-10T09:00:00Z" }),
      event({ id: "early", start: "2026-09-10T02:00:00Z", end: "2026-09-10T03:00:00Z" }),
      event({ id: "allday", allDay: true, start: "2026-09-10", end: "2026-09-10" }),
    ],
    { now: NOW, timeZone: TZ },
  );
  assert.deepEqual(
    days[0].events.map((entry) => entry.id),
    ["allday", "early", "late"],
  );
});

test("marks finished events past but keeps them", () => {
  const days = groupAgenda(
    [
      event({ id: "done", start: "2026-09-10T00:00:00Z", end: "2026-09-10T01:00:00Z" }),
      event({ id: "later", start: "2026-09-10T08:00:00Z", end: "2026-09-10T09:00:00Z" }),
    ],
    { now: NOW, timeZone: TZ },
  );
  assert.deepEqual(
    days[0].events.map((entry) => [entry.id, entry.past]),
    [
      ["done", true],
      ["later", false],
    ],
  );
});

test("an all-day event is never past, whatever the hour", () => {
  const days = groupAgenda([event({ id: "x", allDay: true, start: "2026-09-10", end: "2026-09-10" })], {
    now: NOW,
    timeZone: TZ,
  });
  assert.equal(days[0].events[0].past, false);
});

test("a window of one day is only today", () => {
  const days = groupAgenda(
    [event({ id: "tomorrow", start: "2026-09-11T00:00:00Z", end: "2026-09-11T01:00:00Z" })],
    { now: NOW, timeZone: TZ, days: 1 },
  );
  assert.deepEqual(days.map((day) => day.label), ["Today"]);
});

test("a timezone behind the household still groups by household days", () => {
  // 2026-09-10T16:00Z is still Thursday in London and already Friday in
  // Brisbane; the household's day is the one that counts.
  const days = groupAgenda(
    [event({ id: "fri", start: "2026-09-10T22:00:00Z", end: "2026-09-10T23:00:00Z" })],
    { now: new Date("2026-09-10T16:00:00Z"), timeZone: TZ },
  );
  assert.equal(days[0].label, "Today");
  assert.equal(days[0].events[0].id, "fri");
});

test("an event id carries whose calendar it came from, and survives a round trip", () => {
  // Two calendars can hold the same event; the pair is how the screen says
  // which copy the Remove button means.
  const key = eventKey("alex", "6h8k2p9q1r3s4t5u6v7w8x9y0z");
  assert.deepEqual(splitEventKey(key), {
    profileId: "alex",
    eventId: "6h8k2p9q1r3s4t5u6v7w8x9y0z",
  });
});

test("a malformed event id is refused rather than half-read", () => {
  // Deleting the wrong thing is the failure that matters here, so anything
  // that is not clearly a pair returns nothing at all.
  for (const bad of ["", ":", "alex:", ":abc", "abc", "  "]) {
    assert.equal(splitEventKey(bad), null, `should refuse ${JSON.stringify(bad)}`);
  }
});

test("a Google id is never mistaken for the separator", () => {
  // Google event ids are base32hex plus underscore, so the first colon is
  // always the join and slicing on it cannot cut an id in half.
  const id = "abc_def123";
  assert.equal(splitEventKey(eventKey("sam", id))?.eventId, id);
});
