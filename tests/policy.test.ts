import assert from "node:assert/strict";
import { test } from "node:test";
import { AUTO_EXECUTABLE } from "../src/lib/scan.ts";
import { describeAction, formatMoney } from "../src/lib/actions.ts";
import { TOOL_NAMES } from "../src/lib/tools.ts";

test("email may only auto-execute small, dated, reversible things", () => {
  // The rule that keeps an inbox scanner trustworthy: nothing bulk, nothing
  // that rewrites the recipe library, arrives without a human seeing it.
  assert.equal(AUTO_EXECUTABLE.has("add_calendar_event"), true);
  assert.equal(AUTO_EXECUTABLE.has("add_reminder"), true);
  assert.equal(AUTO_EXECUTABLE.has("add_recipe"), false);
  assert.equal(AUTO_EXECUTABLE.has("add_recipe_to_shopping_list"), false);
  assert.equal(AUTO_EXECUTABLE.has("add_shopping_items"), false);

  for (const name of AUTO_EXECUTABLE) {
    assert.ok(TOOL_NAMES.includes(name), `${name} is not a tool the model can call`);
  }
});

test("what the toast says is what the queue says", () => {
  // Both surfaces call describeAction, so a change to one cannot drift.
  assert.equal(
    describeAction("add_shopping_items", {
      items: [{ name: "oat milk" }, { name: "nappies" }],
    }),
    "Shopping list: oat milk, nappies",
  );
  assert.equal(
    describeAction("add_shopping_items", {
      items: [{ name: "a" }, { name: "b" }, { name: "c" }, { name: "d" }, { name: "e" }],
    }),
    "Shopping list: a, b, c +2 more",
  );
  assert.match(
    describeAction("add_calendar_event", {
      title: "Swimming",
      start: "2026-09-10T16:00",
    }),
    /^Calendar: Swimming — Thu, 10 Sept?, 4:00 pm$/,
  );
  assert.equal(
    describeAction("add_recipe", { name: "Spag bol", ingredients: [1, 2, 3] }),
    "Recipe: Spag bol (3 ingredients)",
  );
  assert.equal(
    describeAction("no_action", { reason: "Just a newsletter" }),
    "Just a newsletter",
  );
});

test("money reads the way an Australian household writes it", () => {
  assert.equal(formatMoney(840, "AUD"), "$840");
  assert.equal(formatMoney(1284.5, "AUD"), "$1,284.50");
});

test("frame settings are clamped, so a bad value can't blank the wall", async () => {
  const { normaliseFrame, DEFAULT_FRAME } = await import("../src/lib/types.ts");

  assert.deepEqual(normaliseFrame(undefined), DEFAULT_FRAME);
  assert.deepEqual(normaliseFrame({}), DEFAULT_FRAME);

  // A one-second slideshow on a kitchen wall is a strobe, and a two-second
  // idle timeout means the dashboard is never readable.
  assert.equal(normaliseFrame({ intervalSeconds: 0 }).intervalSeconds, 3);
  assert.equal(normaliseFrame({ intervalSeconds: 99999 }).intervalSeconds, 600);
  // The TV's portrait choice: only the two values the screen offers survive.
  assert.equal(normaliseFrame({ tvPortraits: "pair" }).tvPortraits, "pair");
  assert.equal(normaliseFrame({ tvPortraits: "sideways" }).tvPortraits, "fill");
  assert.equal(normaliseFrame({ idleSeconds: 1 }).idleSeconds, 30);
  assert.equal(normaliseFrame({ idleSeconds: 99999 }).idleSeconds, 3600);

  assert.equal(normaliseFrame({ intervalSeconds: "nonsense" as never }).intervalSeconds, 12);
  assert.equal(normaliseFrame({ mode: "wobble" as never }).mode, "slideshow");
  assert.deepEqual(normaliseFrame({ selected: "not-an-array" as never }).selected, []);
  assert.deepEqual(normaliseFrame({ selected: [1, 2] as never }).selected, ["1", "2"]);
  assert.equal(normaliseFrame({ enabled: false }).enabled, false);
});

test("Google asks for Gmail only when told to, so the app can be published", async () => {
  const { googleScopes, gmailEnabled, connectionHasGmail } = await import(
    "../src/lib/google.ts"
  );

  delete process.env.GOOGLE_ENABLE_GMAIL;
  // gmail.readonly is a restricted scope: requesting it pins the OAuth app in
  // testing mode, where refresh tokens expire weekly. Off by default.
  assert.equal(gmailEnabled(), false);
  assert.equal(googleScopes().includes("gmail.readonly"), false);
  assert.equal(googleScopes().includes("calendar.events"), true);

  process.env.GOOGLE_ENABLE_GMAIL = "true";
  try {
    assert.equal(googleScopes().includes("gmail.readonly"), true);
  } finally {
    delete process.env.GOOGLE_ENABLE_GMAIL;
  }

  // A connection made before the flag was turned on has no mailbox, and the
  // scanner reads that off the scope it actually stored rather than the config.
  assert.equal(connectionHasGmail("openid email .../calendar.events"), false);
  assert.equal(connectionHasGmail("openid .../gmail.readonly"), true);
  assert.equal(connectionHasGmail(null), false);
});

test("an empty scan says which kind of empty it is", async () => {
  // Read rather than executed: scanMailboxes needs Postgres and a model, and
  // what matters here is that each of the four empty cases is distinguished
  // at all rather than collapsing into the reassuring one.
  const { readFileSync } = await import("node:fs");
  const source = readFileSync(new URL("../src/lib/scan.ts", import.meta.url), "utf8");

  // No backend.
  assert.match(source, /if \(!claudeConfigured\(\)\) \{[\s\S]{0,400}?report\.blocked/);
  // No connected account at all, and accounts that are not mailboxes.
  assert.match(source, /No account is connected/);
  assert.match(source, /No mailbox is connected/);
  // And the guard has to come before the loop, or it reports nothing again.
  const guard = source.indexOf("No mailbox is connected");
  const loop = source.indexOf("for (const connection of connections)");
  assert.ok(guard > 0 && loop > guard, "the guard must precede the walk");
});

test("an inspection changes nothing", async () => {
  // The guarantee that makes the button safe to press on a live household:
  // it must not file, queue, claim a message or move the watermark. Any one
  // of those would turn a diagnostic into a duplicate calendar entry.
  const { readFileSync } = await import("node:fs");
  const source = readFileSync(new URL("../src/lib/scan.ts", import.meta.url), "utf8");

  const start = source.indexOf("if (options.inspect) {");
  const end = source.indexOf("// The insert is the claim", start);
  assert.ok(start > 0 && end > start, "the inspect branch should precede the claim");
  const branch = source.slice(start, end);
  for (const forbidden of ["runToolCall", "queueApproval", "alreadySeen", "markScanned"]) {
    assert.doesNotMatch(branch, new RegExp(forbidden), `inspect must not call ${forbidden}`);
  }

  // And it must leave the watermark alone on the way out.
  const bail = source.indexOf("if (options.inspect) {", end);
  assert.ok(bail > end, "inspect should return before the watermark is written");
  assert.ok(bail < source.indexOf("await markScanned", end), "…and before markScanned");
});

test("a message that could not be classified is retried, not buried", async () => {
  // releaseSeen alone was useless: markScanned always wrote now(), so the
  // message just released fell outside the next window and was never offered
  // again. Holding the watermark is what makes a retry a retry.
  const { readFileSync } = await import("node:fs");
  const source = readFileSync(new URL("../src/lib/scan.ts", import.meta.url), "utf8");
  assert.match(source, /if \(failed > 0\) \{[\s\S]*?\} else \{\s*await markScanned/);
  assert.match(source, /mailbox\.failed = failed/);
});

test("a dated invitation is never silently dropped", async () => {
  // The bug this answers: EMAIL_RULES listed "event invitations" as
  // actionable AND "social chatter" as not, with nothing to say which wins
  // for a casual invite — and every bit of the framing around no_action
  // pushed toward silence. A real drinks invitation with a date, a time and
  // a venue came back as no_action, which from the kitchen is identical to
  // the email never arriving.
  const { EMAIL_RULES, PHOTO_RULES } = await import("../src/lib/llm/prompts.ts");

  // The conflicting term is gone, and the case it covered is defined.
  assert.doesNotMatch(EMAIL_RULES, /social chatter/);
  assert.match(EMAIL_RULES, /chatter is talk with no commitment in it/);
  assert.match(EMAIL_RULES, /never no_action/);

  // And email now agrees with the photo prompt about which error to make.
  // These two read the same household's post and disagreed: one preferred a
  // parked item, the other preferred silence.
  assert.match(PHOTO_RULES, /beats a silent miss/);
  assert.match(EMAIL_RULES, /A silent miss costs them/);
  assert.match(EMAIL_RULES, /propose it at low confidence/);
});

test("the reason behind no_action is kept, not discarded", async () => {
  // no_action takes a REQUIRED reason — "one short line for the person" —
  // and every caller dropped it: judge skips the call, and so did the first
  // version of the inspection. The scanner spent a week explaining itself
  // into nothing while a person stood in a kitchen guessing.
  const { readFileSync } = await import("node:fs");
  const source = readFileSync(new URL("../src/lib/scan.ts", import.meta.url), "utf8");

  const start = source.indexOf("async function inspect(");
  const end = source.indexOf("export async function scanMailboxes", start);
  const body = source.slice(start, end);
  assert.ok(start > 0 && end > start);
  assert.match(body, /row\.verdict = reason\.trim\(\)/, "the inspection must keep the reason");

  // And the schema still requires one, so there is always something to keep.
  const { HOUSEHOLD_TOOLS } = await import("../src/lib/tools.ts");
  const noAction = HOUSEHOLD_TOOLS.find((tool) => tool.name === "no_action");
  assert.ok(noAction);
  const schema = noAction.input_schema as { required?: string[] };
  assert.ok(schema.required?.includes("reason"), "no_action must keep requiring a reason");
});

test("a failed classification is an error, not an empty success", async () => {
  // The root of the whole hunt. classifyEmail caught every failure and
  // returned { calls: [], reply: "" }, so a dead CLI arrived downstream as a
  // model that had read the email and decided it needed nothing. Three
  // rounds of display changes could not matter: the failure never reached
  // any of them.
  const { readFileSync } = await import("node:fs");
  const cli = readFileSync(new URL("../src/lib/llm/cli.ts", import.meta.url), "utf8");

  const start = cli.indexOf("async classifyEmail(");
  const end = cli.indexOf("\n  },", start);
  assert.ok(start > 0 && end > start);
  // Comments only, stripped: the explanation of this fix quotes the code it
  // removed, and an assertion that reads prose is not checking anything.
  const body = cli
    .slice(start, end)
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n");
  assert.doesNotMatch(
    body,
    /return \{ calls: \[\], reply: "" \}/,
    "classifyEmail must not fabricate a successful empty result",
  );
  assert.doesNotMatch(body, /catch/, "the per-message catch upstream is the one that protects a scan");

  // And that upstream protection has to still be there, or this trades one
  // fault for a scan that stops at the first bad message.
  const scan = readFileSync(new URL("../src/lib/scan.ts", import.meta.url), "utf8");
  assert.match(scan, /await judge\([\s\S]{0,200}?\} catch \(error\) \{[\s\S]{0,200}?releaseSeen/);
});

test("a backend that cannot run is reported once, before any message", async () => {
  const { readFileSync } = await import("node:fs");
  const source = readFileSync(new URL("../src/lib/scan.ts", import.meta.url), "utf8");
  const health = source.indexOf("await backendHealth()");
  const walk = source.indexOf("for (const connection of connections)");
  const db = source.indexOf("listConnections()");
  assert.ok(health > 0, "the scan should ask whether the backend works");
  assert.ok(health < walk, "and ask before reading any mailbox");
  // Before the database too: it depends on nothing else, so a dead backend
  // should be named even when something further in is also broken.
  assert.ok(health < db, "and before the database read");
  assert.match(source, /is not answering, so nothing can be/);
});

test("the settings screen names the model the active backend will use", async () => {
  // It was CLAUDE_MODEL regardless, under a comment promising "the model this
  // deployment will actually use" -- but that is the API backend's variable,
  // and this household runs CLAUDE_BACKEND=cli. So the screen displayed a
  // model the machine was not using, while a wrong model id is a leading
  // cause of the exit 1 being chased.
  const { activeModel } = await import("../src/lib/llm/index.ts");
  const saved = { ...process.env };
  try {
    process.env.CLAUDE_BACKEND = "cli";
    process.env.CLAUDE_CLI_MODEL = "opus";
    delete process.env.CLAUDE_CLI_EMAIL_MODEL;
    process.env.CLAUDE_MODEL = "claude-opus-5";
    assert.equal(activeModel(), "opus", "the cli backend's model, not the api one's");

    process.env.CLAUDE_CLI_EMAIL_MODEL = "haiku";
    assert.equal(activeModel(), "opus, email haiku", "and the email model when it differs");

    process.env.CLAUDE_BACKEND = "api";
    assert.match(activeModel(), /^claude-opus-5/);
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
    Object.assign(process.env, saved);
  }
});

test("the email model no longer comes from a file nobody can edit", async () => {
  // CLAUDE_CLI_EMAIL_MODEL=haiku lived in .env.local on a wall-mounted
  // machine with no keyboard, so the one setting that decides whether the
  // scanner reads an email well could never be changed. Same argument that
  // moved playlists into Postgres.
  const { readFileSync } = await import("node:fs");
  const cli = readFileSync(new URL("../src/lib/llm/cli.ts", import.meta.url), "utf8");
  const code = cli
    .split("\n")
    .filter((line) => !line.trim().startsWith("*") && !line.trim().startsWith("//"))
    .join("\n");
  assert.doesNotMatch(code, /process\.env\.CLAUDE_CLI_EMAIL_MODEL/);

  const { DEFAULT_CLI_EMAIL_MODEL } = await import("../src/lib/llm/cli.ts");
  assert.equal(DEFAULT_CLI_EMAIL_MODEL, "sonnet", "haiku misread a dated invitation as chatter");
});

test("only the models the screen offers can be chosen", async () => {
  // The value reaches a subprocess as --model, so this is a list and not a
  // filter on a free string.
  const { EMAIL_MODEL_CHOICES, isUsableModel } = await import("../src/lib/model-choice.ts");
  const values = EMAIL_MODEL_CHOICES.map((choice) => choice.value);
  assert.deepEqual(values, ["", "opus", "sonnet", "haiku"]);
  assert.ok(!isUsableModel("opus; rm -rf /"));
  assert.ok(!isUsableModel("--dangerously-skip-permissions"));
  assert.ok(isUsableModel("claude-haiku-4-5"));

  const { readFileSync } = await import("node:fs");
  const route = readFileSync(
    new URL("../src/app/api/settings/email-model/route.ts", import.meta.url),
    "utf8",
  );
  assert.match(route, /allowed\.includes\(wanted\)/, "the route must check against the list");
});

test("Scan now looks back a day; the scheduled task keeps its watermark", async () => {
  // The watermark had already moved past the message this whole hunt was
  // about, so "continue from where we got to" could never have filed it.
  // Safe because alreadySeen claims every message: a wider window only lets
  // through the ones never successfully judged.
  const { readFileSync } = await import("node:fs");
  const scan = readFileSync(new URL("../src/lib/scan.ts", import.meta.url), "utf8");
  assert.match(scan, /const since = options\.hours\s*\n?\s*\?/);
  assert.match(scan, /connection\.lastScannedAt \?\?/, "no hours still means the watermark");

  const route = readFileSync(
    new URL("../src/app/api/scan/route.ts", import.meta.url),
    "utf8",
  );
  assert.match(route, /startLiveScan\(\{ hours: 24/, "both buttons look back a day");

  // The cron path must not have gained a window, or the unattended scan
  // starts re-walking a day of mail every fifteen minutes.
  const cron = readFileSync(
    new URL("../src/app/api/cron/scan-email/route.ts", import.meta.url),
    "utf8",
  );
  assert.match(cron, /scanMailboxes\(\)/, "the scheduled scan takes no options");
});

test("a tile does not hide the evidence of its own failure", async () => {
  // The robots tab was gated on `robots.length > 0`, so an unreachable Home
  // Assistant emptied the list and the tab deleted itself -- along with the
  // error banner in Robots.tsx written for precisely that case, which became
  // unreachable because reaching it required the tab. "No robots" and "could
  // not ask" are different answers and the wall showed neither.
  const { readFileSync } = await import("node:fs");
  const dash = readFileSync(
    new URL("../src/components/Dashboard/Dashboard.tsx", import.meta.url),
    "utf8",
  );

  const robots = /\{robots\.data\?\.configured &&\s*\(robots\.data\.robots\.length > 0 \|\| robots\.data\.error\) \? \(/;
  assert.match(dash, robots, "the robots tab must survive an error with no robots");

  // Cameras had it right all along: configured is the only gate.
  assert.match(dash, /\{cameras\.data\?\.configured \? \(/);

  // And the tile still has something to say in each case.
  const tile = readFileSync(
    new URL("../src/components/Dashboard/Robots.tsx", import.meta.url),
    "utf8",
  );
  assert.match(tile, /if \(!data\.configured\)/);
  assert.match(tile, /if \(data\.error\)/);
  assert.match(tile, /data\.robots\.length === 0/);
});
