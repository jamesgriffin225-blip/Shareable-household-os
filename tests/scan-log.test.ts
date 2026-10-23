import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { parseScanLog } from "../src/lib/scan-log.ts";

const REPORT =
  '{"scanned":1,"actioned":1,"queued":0,"mailboxes":[{"profileId":"alex","provider":"microsoft","account":"sam@example.com","messages":1}]}';

test("the last line is the state, not the first", () => {
  const log = [
    "2026-10-09T12:45:00  scanned: {\"scanned\":0,\"actioned\":0,\"queued\":0,\"mailboxes\":[]}",
    `2026-10-09T13:00:00  scanned: ${REPORT}`,
  ].join("\n");
  const state = parseScanLog(log);
  assert.equal(state.at, "2026-10-09T13:00:00");
  assert.equal(state.actioned, 1);
  assert.equal(state.mailboxes[0].account, "sam@example.com");
});

test("a failure is reported as one, not as a scan that found nothing", () => {
  // These are opposite answers to "why did nothing arrive", and the whole
  // point of the log is telling them apart.
  const state = parseScanLog("2026-10-09T13:00:00  failed: Unable to connect to the remote server");
  assert.equal(state.failure, "Unable to connect to the remote server");
  assert.equal(state.scanned, null);
});

test("a skipped mailbox keeps its reason", () => {
  const log =
    '2026-10-09T13:00:00  scanned: {"scanned":0,"actioned":0,"queued":0,"mailboxes":' +
    '[{"provider":"google","account":"a@b.com","messages":0,"note":"Calendar only — Gmail access was not granted"},' +
    '{"provider":"microsoft","account":"c@d.com","messages":0,"needsReauth":true,"error":"interaction_required"}]}';
  const state = parseScanLog(log);
  assert.match(state.mailboxes[0].note ?? "", /Calendar only/);
  assert.equal(state.mailboxes[0].needsReauth, false);
  assert.equal(state.mailboxes[1].needsReauth, true);
  assert.equal(state.mailboxes[1].error, "interaction_required");
});

test("a one-element array that arrived unwrapped is still a mailbox", () => {
  // PowerShell collapses a single-element array into a bare object on any
  // JSON round trip. The script avoids the round trip, but a parser that
  // falls over on this would blame the scanner for the serialiser.
  const log =
    '2026-10-09T13:00:00  scanned: {"scanned":1,"actioned":0,"queued":1,"mailboxes":{"provider":"microsoft","account":"c@d.com","messages":1}}';
  const state = parseScanLog(log);
  assert.equal(state.mailboxes.length, 1);
  assert.equal(state.mailboxes[0].account, "c@d.com");
});

test("a truncated line costs the report, not the screen", () => {
  const log = [
    "2026-10-09T12:45:00  scanned: {\"scanned\":0,\"actioned\":0,\"queued\":0,\"mailboxes\":[]}",
    '2026-10-09T13:00:00  scanned: {"scanned":1,"action',
  ].join("\n");
  const state = parseScanLog(log);
  assert.equal(state.at, "2026-10-09T13:00:00");
  assert.match(state.failure ?? "", /could not be read/);
  assert.equal(state.log.length, 2, "the raw tail is still shown");
});

test("an empty log is not a scan that found nothing", () => {
  const state = parseScanLog("");
  assert.equal(state.at, null);
  assert.equal(state.scanned, null);
  assert.equal(state.failure, null);
});

test("a PowerShell byte-order mark does not eat the first line", () => {
  const state = parseScanLog(
    '﻿2026-10-09T13:00:00  scanned: {"scanned":2,"actioned":0,"queued":2,"mailboxes":[]}',
  );
  assert.equal(state.queued, 2);
});

test("the scanner logs, and the updater delivers the script that does it", () => {
  const read = (name: string) =>
    readFileSync(new URL(`../scripts/${name}`, import.meta.url), "utf8");

  const tasks = read("tasks.ps1");
  // The helper scripts moved here from setup-appliance.ps1 for one reason:
  // a script written once at setup can only be fixed by typing on the wall.
  assert.match(tasks, /function Write-HouseholdHelpers/);
  assert.match(tasks, /scan\.log/, "the scanner must write a log");
  assert.match(tasks, /Invoke-WebRequest/, "log the raw body, not a re-serialised one");

  for (const name of ["setup-appliance.ps1", "update.ps1"]) {
    const script = read(name);
    assert.match(script, /Write-HouseholdHelpers/, `${name} should write the helpers`);
    // Two copies of a heredoc means the machine keeps whichever ran last.
    assert.doesNotMatch(
      script,
      /CRON_SECRET=\(\.\+\)/,
      `${name} should not carry its own copy of scan-email.ps1`,
    );
  }
});

test("a failed scan is logged rather than swallowed", () => {
  const tasks = readFileSync(new URL("../scripts/tasks.ps1", import.meta.url), "utf8");
  const block = tasks.slice(tasks.indexOf("function Write-HouseholdHelpers"));
  // The old version discarded the failure on the grounds that the app might
  // just be starting. True, and indistinguishable from a dead mailbox.
  assert.match(block, /Note "failed: /);
  assert.match(block, /Note "scanned: /);
});

test("a blocked scan is not a scan that found nothing", () => {
  // The defect this answers: no model backend, no connected account, an
  // account that is not a mailbox, and a genuinely quiet morning all produced
  // a byte-identical empty report. Only the last is reassuring, and the
  // screen was showing the reassuring reading for all four.
  const log =
    '2026-10-09T13:00:00  scanned: {"scanned":0,"actioned":0,"queued":0,"mailboxes":[],' +
    '"blocked":"No account is connected, so there is no mailbox to read."}';
  const state = parseScanLog(log);
  assert.match(state.blocked ?? "", /No account is connected/);
  assert.equal(state.failure, null, "blocked is not the same as failed");
});

test("a quiet scan stays quiet", () => {
  const log = '2026-10-09T13:00:00  scanned: {"scanned":0,"actioned":0,"queued":0,"mailboxes":[]}';
  assert.equal(parseScanLog(log).blocked, null);
});
