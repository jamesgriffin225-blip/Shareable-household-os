import assert from "node:assert/strict";
import { test } from "node:test";
import { ASK_SYSTEM, formatBriefing } from "../src/lib/briefing.ts";
import { dayKeysIn } from "../src/components/Dashboard/calendar-range.ts";
import type { CalendarEvent, Profile, Reminder, ShoppingItem } from "../src/lib/types.ts";

const PROFILES: Profile[] = [
  { id: "alex", name: "Alex", color: "#b3541e" },
  { id: "sam", name: "Sam", color: "#2c6e8f" },
];

function event(overrides: Partial<CalendarEvent>): CalendarEvent {
  return {
    id: "alex:x",
    profileId: "alex",
    title: "Something",
    start: "2026-10-03T14:00:00+10:00",
    end: "2026-10-03T15:00:00+10:00",
    allDay: false,
    location: null,
    notes: null,
    htmlLink: null,
    ...overrides,
  };
}

const EMPTY: { shopping: ShoppingItem[]; reminders: Reminder[] } = {
  shopping: [],
  reminders: [],
};

function brief(events: CalendarEvent[], days: string[], extra = EMPTY): string {
  return formatBriefing({
    todayKey: "2026-09-28",
    timeZone: "Australia/Brisbane",
    profiles: PROFILES,
    events,
    days,
    ...extra,
  });
}

test("free days are stated, not left to be inferred from absence", () => {
  // The whole point. "When are we next free on a Saturday afternoon?" is a
  // question whose answer is a day that is NOT in the event list, so handing
  // over only what is booked and hoping the gap is noticed is a guess.
  const days = dayKeysIn({ from: "2026-10-03", to: "2026-10-05" });
  const text = brief([event({ start: "2026-10-04T09:00:00+10:00", end: "2026-10-04T10:00:00+10:00" })], days);

  assert.match(text, /Saturday 3 Oct: \(nothing on\)/);
  assert.match(text, /Monday 5 Oct: \(nothing on\)/);
  assert.match(text, /Sunday 4 Oct:/);
  assert.doesNotMatch(text, /Sunday 4 Oct: \(nothing on\)/);
});

test("every day in the window appears, in order, exactly once", () => {
  const days = dayKeysIn({ from: "2026-09-28", to: "2026-10-12" });
  const text = brief([], days);
  let cursor = -1;
  for (const key of days) {
    const label = new Intl.DateTimeFormat("en-AU", {
      timeZone: "UTC",
      weekday: "long",
      day: "numeric",
      month: "short",
    }).format(new Date(`${key}T12:00:00Z`));
    const at = text.indexOf(label);
    assert.ok(at > cursor, `${label} is missing or out of order`);
    cursor = at;
  }
});

test("times are the household's, not the server's", () => {
  // The event is 2pm in Brisbane. A briefing that renders it in UTC would
  // answer "is Saturday afternoon free?" with midnight.
  const text = brief([event({})], ["2026-10-03"]);
  assert.match(text, /2:00 pm-3:00 pm/);
  assert.match(text, /Times are Australia\/Brisbane/);
});

test("an all-day event is not given invented hours", () => {
  const text = brief(
    [event({ allDay: true, start: "2026-10-03", end: "2026-10-03", title: "Bin night" })],
    ["2026-10-03"],
  );
  assert.match(text, /all day Bin night/);
  assert.doesNotMatch(text, /12:00 am/);
});

test("an event says whose it is", () => {
  const text = brief(
    [event({ profileId: "sam", title: "Physio", location: "Northside" })],
    ["2026-10-03"],
  );
  assert.match(text, /Sam 2:00 pm-3:00 pm Physio @ Northside/);
});

test("today and the household are stated up front", () => {
  const text = brief([], ["2026-09-28"]);
  assert.match(text.split("\n")[0], /Today is Monday 28 Sept 2026/);
  assert.match(text, /The household is Alex and Sam/);
});

test("empty lists say they are empty rather than being omitted", () => {
  // A missing section reads as "not given"; an empty one reads as "nothing to
  // get", and only one of those answers "do we need milk?".
  const text = brief([], ["2026-09-28"]);
  assert.match(text, /SHOPPING LIST: empty\./);
  assert.match(text, /TO DO: nothing outstanding\./);
});

test("lists are rendered with their quantities", () => {
  const text = brief([], ["2026-09-28"], {
    shopping: [
      { name: "Nappies", quantity: "2 packs", checkedAt: null } as ShoppingItem,
      { name: "Milk", quantity: null, checkedAt: null } as ShoppingItem,
      // Already in the trolley: not something still to get.
      { name: "Cat food", quantity: null, checkedAt: "2026-09-28T01:00:00Z" } as ShoppingItem,
    ],
    reminders: [
      { title: "Call the plumber", dueAt: "2026-09-29T00:00:00Z", doneAt: null } as Reminder,
      { title: "Done thing", dueAt: null, doneAt: "2026-09-27T00:00:00Z" } as Reminder,
    ],
  });
  assert.match(text, /SHOPPING LIST \(2\): 2 packs Nappies, Milk\./);
  assert.doesNotMatch(text, /Cat food/);
  assert.match(text, /TO DO \(1\): Call the plumber \(due 2026-09-29\)/);
  assert.doesNotMatch(text, /Done thing/);
});

test("the instructions forbid the failure that matters", () => {
  // A confident wrong "yes, Saturday is free" is worse than no answer, so the
  // system prompt has to rule out inventing and require saying what is missing.
  assert.match(ASK_SYSTEM, /Never invent/);
  assert.match(ASK_SYSTEM, /say what is missing|say exactly what is missing/);
  assert.match(ASK_SYSTEM, /nothing on\) is free/);
});
