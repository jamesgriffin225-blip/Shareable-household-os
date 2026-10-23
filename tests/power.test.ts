import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { describeTimeout, parseAcSeconds } from "../src/lib/power.ts";

/**
 * Real output, pasted from `powercfg /q SCHEME_CURRENT SUB_SLEEP STANDBYIDLE`.
 * The shape is the whole difficulty: there are two indexes, hex, and the one
 * that governs a permanently plugged-in wall display is the first.
 */
const NEVER = `
Power Scheme GUID: 381b4222-f694-41f0-9685-ff5bb260df2e  (Balanced)
  Subgroup GUID: 238c9fa8-0aad-41ed-83f4-97be242c8f20  (Sleep)
    Power Setting GUID: 29f6c1db-86da-48c5-9fdb-f2b67b1f44da  (Sleep after)
      GUID Alias: STANDBYIDLE
      Minimum Possible Setting: 0x00000000
      Maximum Possible Setting: 0xffffffff
      Possible Settings increment: 0x00000001
      Possible Settings units: Seconds
    Current AC Power Setting Index: 0x00000000
    Current DC Power Setting Index: 0x00000708
`;

test("the AC index is read, not the DC one", () => {
  // The DC value here is 30 minutes, and on battery that is correct. Reading
  // it would report a wall that sleeps when it does not.
  assert.equal(parseAcSeconds(NEVER), 0);
});

test("a timeout is read as seconds", () => {
  const twenty = NEVER.replace("Current AC Power Setting Index: 0x00000000", "Current AC Power Setting Index: 0x000004b0");
  assert.equal(parseAcSeconds(twenty), 1200);
});

test("output with no index in it is unknown, not zero", () => {
  // Zero means "never sleep", so guessing it from a failed read would put
  // "Stays awake on mains" on the screen of a machine that is asleep.
  assert.equal(parseAcSeconds(""), null);
  assert.equal(parseAcSeconds("Invalid Parameters -- try /? for help"), null);
});

test("timeouts are described in the units a person would say", () => {
  assert.equal(describeTimeout(0), "never");
  assert.equal(describeTimeout(null), "unknown");
  assert.equal(describeTimeout(600), "after 10 minutes");
  assert.equal(describeTimeout(60), "after 1 minute");
  assert.equal(describeTimeout(3600), "after 1 hour");
  assert.equal(describeTimeout(7200), "after 2 hours");
});

test("the browser copy of describeTimeout has not drifted from this one", () => {
  // Settings cannot import from src/lib here without pulling node:child_process
  // into the client bundle, so the function is duplicated. A copy nobody
  // checks is a copy that disagrees.
  const page = readFileSync(new URL("../src/app/settings/page.tsx", import.meta.url), "utf8");
  const copy = /function describeTimeout\(seconds: number \| null\): string \{[\s\S]*?\n\}/.exec(page);
  assert.ok(copy, "settings should still have its own describeTimeout");
  const source = readFileSync(new URL("../src/lib/power.ts", import.meta.url), "utf8");
  const original = /function describeTimeout\(seconds: number \| null\): string \{[\s\S]*?\n\}/.exec(source);
  assert.ok(original);
  assert.equal(copy[0], original[0].replace(/^export /, ""));
});

test("the power settings are applied by the machine, not by a person", () => {
  const read = (name: string) =>
    readFileSync(new URL(`../scripts/${name}`, import.meta.url), "utf8");

  // Defined once, beside the scheduled tasks, for the same reason: there is no
  // keyboard on the wall.
  assert.match(read("tasks.ps1"), /function Set-HouseholdPower/);
  for (const name of ["setup-appliance.ps1", "update.ps1"]) {
    assert.match(read(name), /Set-HouseholdPower/, `${name} should apply the power settings`);
  }

  // The bug this fixes: these were printed as something to run in an
  // administrator window, and elevation here switches account. Power schemes
  // are per-user, so they configured a user who never shows the dashboard.
  // `powercfg /change` never needed administrator for one's own scheme.
  const setup = read("setup-appliance.ps1");
  const admin = setup.slice(setup.indexOf("needs an ADMINISTRATOR window"));
  assert.doesNotMatch(admin, /powercfg/, "powercfg must not be printed as an elevated step");
});

test("only the AC side is set, so a real power cut can still sleep", () => {
  const tasks = readFileSync(new URL("../scripts/tasks.ps1", import.meta.url), "utf8");
  const block = tasks.slice(
    tasks.indexOf("function Set-HouseholdPower"),
    tasks.indexOf("function Register-HouseholdTasks"),
  );
  assert.match(block, /standby-timeout-ac/);
  assert.match(block, /hibernate-timeout-ac/);
  assert.doesNotMatch(block, /-timeout-dc/);
});
