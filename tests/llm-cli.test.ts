import assert from "node:assert/strict";
import { test } from "node:test";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  extractJson,
  readActions,
  readEnvelope,
  describeCliFailure,
  clearCliFailure,
  looksLikeAuthFailure,
  noteCliFailure,
  readSignedIn,
  recentCliFailure,
  runCli,
} from "../src/lib/llm/cli.ts";
import { describeTools, jsonContract } from "../src/lib/llm/prompts.ts";
import { HOUSEHOLD_TOOLS } from "../src/lib/tools.ts";

// ------------------------------------------------------------ the contract

test("the prose tool list is generated from the tool definitions", () => {
  // If this is ever written by hand, the two backends drift the first time a
  // field is added and only one of them learns about it.
  const prose = describeTools();
  for (const tool of HOUSEHOLD_TOOLS) {
    assert.ok(prose.includes(`"${tool.name}"`), `${tool.name} missing`);
    const schema = tool.input_schema as any;
    for (const field of Object.keys(schema.properties ?? {})) {
      assert.ok(prose.includes(field), `${tool.name}.${field} missing from prose`);
    }
  }
  // Nested item fields matter too — this is where shopping items live.
  assert.ok(prose.includes("quantity"));
  assert.ok(prose.includes("Meat & Seafood"), "the category enum has to be listed");
  assert.ok(jsonContract().includes('"actions"'));
});

// -------------------------------------------------------------- envelopes

test("the result is read out of the CLI's JSON envelope", () => {
  assert.equal(
    readEnvelope(JSON.stringify({ type: "result", is_error: false, result: "hello" })),
    "hello",
  );
});

test("plain stdout from an older CLI is still usable", () => {
  assert.equal(readEnvelope("just some text"), "just some text");
});

test("an error envelope raises rather than being parsed as an answer", () => {
  assert.throws(
    () => readEnvelope(JSON.stringify({ is_error: true, result: "rate limit" })),
    /rate limit/,
  );
  assert.throws(() => readEnvelope("   "), /returned nothing/);
});

// ------------------------------------------------------- loose JSON output

test("JSON survives a fence, a preamble and a sign-off", () => {
  const wanted = { reply: "ok", actions: [] };
  assert.deepEqual(extractJson('{"reply":"ok","actions":[]}'), wanted);
  assert.deepEqual(extractJson('```json\n{"reply":"ok","actions":[]}\n```'), wanted);
  assert.deepEqual(extractJson('```\n{"reply":"ok","actions":[]}\n```'), wanted);
  assert.deepEqual(
    extractJson('Here you go:\n{"reply":"ok","actions":[]}\nHope that helps!'),
    wanted,
  );
});

test("unparseable output raises the error the retry looks for", () => {
  assert.throws(() => extractJson("I could not do that"), /parseable JSON/);
  assert.throws(() => extractJson("[1,2,3]"), /parseable JSON/);
});

// ------------------------------------------------------------- the mapping

test("actions become the same tool calls the API backend produces", () => {
  const result = readActions({
    reply: "Added two things.",
    actions: [
      {
        action: "add_shopping_items",
        confidence: "high",
        items: [{ name: "oat milk", category: "Dairy" }],
      },
      {
        action: "add_calendar_event",
        confidence: "medium",
        confidence_reason: "no year given",
        title: "Swimming",
        start: "2026-09-10T16:00",
      },
    ],
  });

  assert.equal(result.reply, "Added two things.");
  assert.deepEqual(
    result.calls.map((call) => call.name),
    ["add_shopping_items", "add_calendar_event"],
  );
  // `action` is stripped; everything else reaches the executor untouched.
  assert.deepEqual(result.calls[0].input, {
    confidence: "high",
    items: [{ name: "oat milk", category: "Dairy" }],
  });
  assert.equal(result.calls[1].input.confidence_reason, "no year given");
});

test("an invented action name is dropped, not guessed at", () => {
  const result = readActions({
    actions: [
      { action: "delete_everything", confidence: "high" },
      { action: "add_reminder", title: "Bins", confidence: "high" },
      "not an object",
      null,
      { confidence: "high" },
    ],
  });
  assert.deepEqual(
    result.calls.map((call) => call.name),
    ["add_reminder"],
  );
});

test("a reply with no actions at all is empty, not a crash", () => {
  // Still the point: malformed input must not throw. What changed is that
  // the emptiness is now explained -- silently empty read as "the model
  // decided nothing was needed", which is a different claim.
  const bare = readActions({});
  assert.deepEqual(bare.calls, []);
  assert.equal(bare.reply, "");

  const wrongTypes = readActions({ actions: "nope", reply: 42 });
  assert.deepEqual(wrongTypes.calls, []);
  assert.equal(wrongTypes.reply, "");
  assert.ok(wrongTypes.dropped?.length, "and it should say why it is empty");
});

// ------------------------------------------------- the subprocess for real

/** A stand-in `claude` that records its input and prints what we tell it to. */
function fakeClaude(body: string): { dir: string; path: string } {
  const dir = mkdtempSync(join(tmpdir(), "fakeclaude-"));
  const path = join(dir, "claude");
  writeFileSync(path, `#!/bin/sh\n${body}\n`);
  chmodSync(path, 0o755);
  return { dir, path };
}

test("the prompt goes over stdin and the model is passed as a flag", async () => {
  const { dir, path } = fakeClaude(
    'IN=$(cat); printf \'{"type":"result","is_error":false,"result":%s}\' ' +
      '"$(printf \'%s\' "stdin:$IN args:$*" | sed \'s/"/\\\\"/g;s/^/"/;s/$/"/\')"',
  );
  process.env.CLAUDE_CLI_PATH = path;
  try {
    const out = readEnvelope(await runCli("hello prompt", { model: "opus" }));
    assert.match(out, /stdin:hello prompt/, "the prompt must arrive on stdin");
    assert.match(out, /-p/);
    assert.match(out, /--output-format json/);
    assert.match(out, /--model opus/);
    assert.doesNotMatch(out, /--allowedTools/, "Read is only allowed for photos");
  } finally {
    delete process.env.CLAUDE_CLI_PATH;
    void dir;
  }
});

test("Read is allowed only when there is a photo to read", async () => {
  const { path } = fakeClaude(
    'cat > /dev/null; printf \'{"is_error":false,"result":"args:%s"}\' "$*"',
  );
  process.env.CLAUDE_CLI_PATH = path;
  try {
    const out = readEnvelope(
      await runCli("x", { model: "opus", allowRead: true }),
    );
    assert.match(out, /--allowedTools Read/);
  } finally {
    delete process.env.CLAUDE_CLI_PATH;
  }
});

test("a non-zero exit carries stderr, which is where rate limits arrive", async () => {
  const { path } = fakeClaude('cat > /dev/null; echo "usage limit reached" >&2; exit 1');
  process.env.CLAUDE_CLI_PATH = path;
  try {
    await assert.rejects(runCli("x", { model: "opus" }), /exited 1.*usage limit reached/s);
  } finally {
    delete process.env.CLAUDE_CLI_PATH;
  }
});

test("a missing binary says so plainly", async () => {
  process.env.CLAUDE_CLI_PATH = join(tmpdir(), "definitely-not-a-real-binary");
  try {
    await assert.rejects(runCli("x", { model: "opus" }), /Could not run/);
  } finally {
    delete process.env.CLAUDE_CLI_PATH;
  }
});

test("a hung CLI is killed rather than holding the request open", async () => {
  // `sh` spawns `sleep` as a grandchild that inherits stdout, so killing the
  // CLI does not close the pipe. This is exactly the case that used to hang a
  // request long past its deadline, so the assertion is on the clock too.
  const { path } = fakeClaude("cat > /dev/null; sleep 5 &\nwait");
  process.env.CLAUDE_CLI_PATH = path;
  process.env.CLAUDE_CLI_TIMEOUT_MS = "700";
  const started = Date.now();
  try {
    await assert.rejects(runCli("x", { model: "opus" }), /timed out/);
    assert.ok(
      Date.now() - started < 5000,
      `settled in ${Date.now() - started}ms — it must not wait for the pipe`,
    );
  } finally {
    delete process.env.CLAUDE_CLI_PATH;
    delete process.env.CLAUDE_CLI_TIMEOUT_MS;
  }
});

test("a model name is pattern-checked before it reaches a command line", async () => {
  // This used to poison CLAUDE_CLI_MODEL and assert that classifyEmail
  // returned { calls: [], reply: "" } -- encoding the swallow that made a
  // dead CLI look like a model deciding nothing was needed. The property
  // worth keeping is the one in the title, and the name now arrives from the
  // caller rather than the environment, so that is where it is checked.
  const { cliBackend } = await import("../src/lib/llm/cli.ts");
  const mail = {
    mail: { id: "1", from: "a", subject: "b", receivedAt: "c", body: "d", link: null },
    mailbox: "test",
    context: {
      capturedBy: { id: "alex", name: "Alex", color: "#000" },
      profiles: [{ id: "alex", name: "Alex", color: "#000" }],
      recipes: [],
    },
  };

  await assert.rejects(
    () => cliBackend.classifyEmail({ ...mail, model: "opus; rm -rf /" }),
    /is not a usable model name/,
    "a chosen model must never reach a command line unchecked",
  );
  await assert.rejects(
    () => cliBackend.classifyEmail({ ...mail, model: "--dangerously-skip-permissions" }),
    /is not a usable model name/,
  );
});

test("a failed email classification raises instead of reporting an empty success", async () => {
  // The root defect of this whole episode, kept as a test so it cannot come
  // back: an unreadable message must reach the per-message handler upstream,
  // which releases the claim and holds the watermark, rather than arriving
  // downstream as a model that read the email and chose to do nothing.
  const { cliBackend } = await import("../src/lib/llm/cli.ts");
  const previous = process.env.CLAUDE_CLI_PATH;
  process.env.CLAUDE_CLI_PATH = "/nonexistent/claude";
  try {
    await assert.rejects(
      () =>
        cliBackend.classifyEmail({
          mail: { id: "1", from: "a", subject: "b", receivedAt: "c", body: "d", link: null },
          mailbox: "test",
          context: {
            capturedBy: { id: "alex", name: "Alex", color: "#000" },
            profiles: [{ id: "alex", name: "Alex", color: "#000" }],
            recipes: [],
          },
        }),
      /Could not run|ENOENT/,
    );
  } finally {
    if (previous === undefined) delete process.env.CLAUDE_CLI_PATH;
    else process.env.CLAUDE_CLI_PATH = previous;
  }
});

test("a reply with no actions array says so instead of looking like a decision", () => {
  // The ambiguity that survived five rounds of debugging: this parses as
  // valid JSON, so nothing errors and no retry fires, and the empty result
  // is indistinguishable from a model that read an email and chose to do
  // nothing about it.
  const result = readActions({ calls: [{ action: "add_calendar_event" }], reply: "" });
  assert.deepEqual(result.calls, []);
  assert.match(result.dropped?.[0] ?? "", /no "actions" array/);
  assert.match(result.dropped?.[0] ?? "", /calls, reply/, "it should name what was there");
});

test("an unrecognised action name is named, not just dropped", () => {
  const result = readActions({ actions: [{ action: "add_event", title: "Drinks" }] });
  assert.deepEqual(result.calls, []);
  assert.match(result.dropped?.[0] ?? "", /"add_event", which is not one of the tools/);
});

test("an action with no name reports the keys it did have", () => {
  const result = readActions({ actions: [{ title: "Drinks", start: "2026-10-09T18:30" }] });
  assert.deepEqual(result.calls, []);
  assert.match(result.dropped?.[0] ?? "", /no "action" name/);
  assert.match(result.dropped?.[0] ?? "", /title, start/);
});

test("an empty object is distinguished from a considered no", () => {
  const result = readActions({});
  assert.match(result.dropped?.[0] ?? "", /empty JSON object/);
});

test("a good reply drops nothing and says nothing", () => {
  const result = readActions({
    actions: [{ action: "add_calendar_event", title: "Drinks", confidence: "high" }],
  });
  assert.equal(result.calls.length, 1);
  assert.equal(result.dropped, undefined, "a clean parse must stay quiet");
});

test("a CLI that reports its failure on stdout is quoted, not reduced to a code", async () => {
  // Exactly what the Surface did: exit 1, nothing on stderr, and the reason
  // on stdout because we asked for --output-format json. Reading stderr
  // alone gave a bare "Claude CLI exited 1" while the answer sat in a
  // variable three lines up — the same discard-and-report-nothing shape that
  // cost this hunt a week.
  const dir = mkdtempSync(join(tmpdir(), "cli-stdout-fail-"));
  const fake = join(dir, "claude");
  writeFileSync(
    fake,
    '#!/bin/sh\ncat >/dev/null\n' +
      'echo \'{"type":"error","error":{"message":"Invalid model name: claude-sonnet-4-5"}}\'\n' +
      "exit 1\n",
  );
  chmodSync(fake, 0o755);

  const previous = process.env.CLAUDE_CLI_PATH;
  process.env.CLAUDE_CLI_PATH = fake;
  try {
    await assert.rejects(
      () => runCli("anything", { model: "claude-sonnet-4-5" }),
      (error: Error) => {
        assert.match(error.message, /exited 1/);
        assert.match(error.message, /model claude-sonnet-4-5/, "it should name the model asked for");
        assert.match(error.message, /Invalid model name/, "and quote what the CLI actually said");
        return true;
      },
    );
  } finally {
    if (previous === undefined) delete process.env.CLAUDE_CLI_PATH;
    else process.env.CLAUDE_CLI_PATH = previous;
  }
});

test("a silent failure says it was silent, rather than implying nothing happened", async () => {
  const dir = mkdtempSync(join(tmpdir(), "cli-silent-fail-"));
  const fake = join(dir, "claude");
  writeFileSync(fake, "#!/bin/sh\ncat >/dev/null\nexit 3\n");
  chmodSync(fake, 0o755);

  const previous = process.env.CLAUDE_CLI_PATH;
  process.env.CLAUDE_CLI_PATH = fake;
  try {
    await assert.rejects(
      () => runCli("anything", { model: "whatever" }),
      /exited 3 \(model whatever\) and printed nothing to stdout or stderr/,
    );
  } finally {
    if (previous === undefined) delete process.env.CLAUDE_CLI_PATH;
    else process.env.CLAUDE_CLI_PATH = previous;
  }
});

// The literal shape the wall produced: the envelope leads with counters, and
// the one sentence worth reading sits well past the first 400 characters.
const WALL_FAILURE =
  '{"duration_api_ms":0,"stop_reason":"stop_sequence",' +
  '"session_id":"ed33db90-3655-4d9d-b546-68bb3ea8607b","total_cost_usd":0,' +
  '"usage":{"output_tokens_details":{"thinking_tokens":0},"input_tokens":0,' +
  '"cache_creation_input_tokens":0,"cache_read_input_tokens":0,"output_tokens":0,' +
  '"server_tool_use":{"web_search_requests":0,"web_fetch_requests":0},' +
  '"service_tier":"standard","cache_creation":{"ephemeral_1h_input_tokens":0,' +
  '"ephemeral_5m_input_tokens":0}},"is_error":true,"type":"result",' +
  '"subtype":"error_during_execution",' +
  '"result":"Invalid model name: haiku. Run /model to see available models."}';

test("the failure envelope is read, not quoted from the top", () => {
  // Truncating the raw text showed a wall of zeros and cut off the reason,
  // which is how a second round of this hunt was spent on a message that
  // said nothing.
  assert.equal(
    describeCliFailure(WALL_FAILURE, ""),
    "Invalid model name: haiku. Run /model to see available models.",
  );
  assert.ok(WALL_FAILURE.indexOf('"result"') > 400, "the reason really is past the old cap");
});

test("a failure envelope with no result falls back to its subtype", () => {
  assert.equal(
    describeCliFailure('{"is_error":true,"type":"result","subtype":"error_max_turns"}', ""),
    "error_max_turns",
  );
});

test("stderr is used when the envelope says nothing useful", () => {
  assert.equal(describeCliFailure("", "not logged in"), "not logged in");
  assert.equal(describeCliFailure("some plain text", ""), "some plain text");
});

test("an error object rather than a result string is read too", () => {
  assert.equal(
    describeCliFailure('{"error":{"message":"credit balance is too low"}}', ""),
    "credit balance is too low",
  );
});

test("runCli surfaces the envelope reason end to end", async () => {
  const dir = mkdtempSync(join(tmpdir(), "cli-envelope-"));
  const fake = join(dir, "claude");
  writeFileSync(fake, `#!/bin/sh\ncat >/dev/null\ncat <<'JSON'\n${WALL_FAILURE}\nJSON\nexit 1\n`);
  chmodSync(fake, 0o755);

  const previous = process.env.CLAUDE_CLI_PATH;
  process.env.CLAUDE_CLI_PATH = fake;
  try {
    await assert.rejects(
      () => runCli("anything", { model: "haiku" }),
      /exited 1 \(model haiku\): Invalid model name: haiku/,
    );
  } finally {
    if (previous === undefined) delete process.env.CLAUDE_CLI_PATH;
    else process.env.CLAUDE_CLI_PATH = previous;
  }
});

test("sign-in state is read from auth status", () => {
  // The whole week in one line. The probe ran --version, which needs no
  // account, so it reported "reachable" for days while every call failed
  // with "OAuth session expired and could not be refreshed".
  assert.equal(readSignedIn('{"loggedIn":true,"authMethod":"oauth_token"}'), true);
  assert.equal(readSignedIn('{"loggedIn":false}'), false);
  assert.equal(readSignedIn('Checking...\n{"loggedIn":false}\n'), false);
});

test("an unfamiliar auth status is not read as signed out", () => {
  // A CLI too old to have the subcommand must not stop a working machine
  // scanning: that would be a worse failure than the one being prevented.
  assert.equal(readSignedIn(""), null);
  assert.equal(readSignedIn("some future format"), null);
  assert.equal(readSignedIn('{"status":"ok"}'), null);
  // But an explicit denial in plain text still counts.
  assert.equal(readSignedIn("You are not logged in."), false);
});

test("health fails when the CLI is signed out, and says how to fix it", async () => {
  const dir = mkdtempSync(join(tmpdir(), "cli-signed-out-"));
  const fake = join(dir, "claude");
  writeFileSync(fake, '#!/bin/sh\necho \'{"loggedIn":false}\'\nexit 0\n');
  chmodSync(fake, 0o755);

  const previous = process.env.CLAUDE_CLI_PATH;
  process.env.CLAUDE_CLI_PATH = fake;
  try {
    const { cliBackend } = await import("../src/lib/llm/cli.ts");
    // Module state is shared across this file, and a neighbouring test
    // recording a failure would make this one pass for the wrong reason.
    clearCliFailure();
    const health = await cliBackend.health();
    assert.equal(health.ok, false, "signed out is not healthy");
    assert.match(health.detail, /signed out/i);
    // The remedy is a button now, not a command typed on a keyboard the
    // machine does not have.
    assert.match(health.detail, /Press Sign in below/, "a person needs the remedy, not the symptom");
  } finally {
    if (previous === undefined) delete process.env.CLAUDE_CLI_PATH;
    else process.env.CLAUDE_CLI_PATH = previous;
  }
});

test("health passes when the CLI is signed in", async () => {
  const dir = mkdtempSync(join(tmpdir(), "cli-signed-in-"));
  const fake = join(dir, "claude");
  writeFileSync(fake, '#!/bin/sh\necho \'{"loggedIn":true}\'\nexit 0\n');
  chmodSync(fake, 0o755);

  const previous = process.env.CLAUDE_CLI_PATH;
  process.env.CLAUDE_CLI_PATH = fake;
  try {
    const { cliBackend } = await import("../src/lib/llm/cli.ts");
    clearCliFailure();
    const health = await cliBackend.health();
    assert.equal(health.ok, true);
    assert.match(health.detail, /signed in/);
  } finally {
    if (previous === undefined) delete process.env.CLAUDE_CLI_PATH;
    else process.env.CLAUDE_CLI_PATH = previous;
  }
});

test("an authentication failure is recognised however it is worded", () => {
  // The exact sentence the wall produced, plus the neighbours it could
  // plausibly produce instead.
  assert.ok(looksLikeAuthFailure("Failed to authenticate: OAuth session expired and could not be refreshed"));
  assert.ok(looksLikeAuthFailure("You are not logged in"));
  assert.ok(looksLikeAuthFailure("401 Unauthorized"));
  assert.ok(!looksLikeAuthFailure("Invalid model name: haiku"));
  assert.ok(!looksLikeAuthFailure("Claude CLI timed out after 120000ms"));
});

test("a live authentication failure outranks a probe that says all is well", async () => {
  // The bug this fixes, twice over. --version could not fail the way a
  // signed-out CLI fails; `auth status` can confirm a credential exists on
  // disk while the token behind it is expired and unrefreshable. A real call
  // is the only thing that cannot be wrong about whether calls work.
  const dir = mkdtempSync(join(tmpdir(), "cli-happy-probe-"));
  const fake = join(dir, "claude");
  writeFileSync(fake, '#!/bin/sh\necho \'{"loggedIn":true}\'\nexit 0\n');
  chmodSync(fake, 0o755);

  const previous = process.env.CLAUDE_CLI_PATH;
  process.env.CLAUDE_CLI_PATH = fake;
  try {
    const { cliBackend } = await import("../src/lib/llm/cli.ts");
    clearCliFailure();
    assert.equal((await cliBackend.health()).ok, true, "nothing has failed yet");

    noteCliFailure("Claude CLI exited 1 (model haiku): Failed to authenticate: OAuth session expired and could not be refreshed");
    const health = await cliBackend.health();
    assert.equal(health.ok, false, "a probe saying loggedIn must not overrule a real failure");
    assert.match(health.detail, /Signed out/);
    assert.match(health.detail, /OAuth session expired/, "quote the evidence");
  } finally {
    clearCliFailure();
    if (previous === undefined) delete process.env.CLAUDE_CLI_PATH;
    else process.env.CLAUDE_CLI_PATH = previous;
  }
});

test("a non-auth failure still turns the row red rather than going unmentioned", async () => {
  const dir = mkdtempSync(join(tmpdir(), "cli-other-fail-"));
  const fake = join(dir, "claude");
  writeFileSync(fake, '#!/bin/sh\necho \'{"loggedIn":true}\'\nexit 0\n');
  chmodSync(fake, 0o755);

  const previous = process.env.CLAUDE_CLI_PATH;
  process.env.CLAUDE_CLI_PATH = fake;
  try {
    const { cliBackend } = await import("../src/lib/llm/cli.ts");
    noteCliFailure("Claude CLI exited 1 (model sonnet): Invalid model name");
    const health = await cliBackend.health();
    assert.equal(health.ok, false);
    assert.match(health.detail, /Invalid model name/);
  } finally {
    clearCliFailure();
    if (previous === undefined) delete process.env.CLAUDE_CLI_PATH;
    else process.env.CLAUDE_CLI_PATH = previous;
  }
});

test("a failure goes stale rather than haunting a machine that was fixed", () => {
  clearCliFailure();
  assert.equal(recentCliFailure(), null);
  noteCliFailure("Failed to authenticate");
  assert.equal(recentCliFailure()?.auth, true);
  clearCliFailure();
  assert.equal(recentCliFailure(), null, "a success clears it, so signing in turns the row green");
});

test("an unrecognised auth status is quoted rather than assumed healthy", async () => {
  // How a signed-out machine kept reporting health: the parser did not know
  // the shape, so it shrugged and said fine. It may still say fine, but it
  // now shows what it was looking at.
  const dir = mkdtempSync(join(tmpdir(), "cli-odd-status-"));
  const fake = join(dir, "claude");
  writeFileSync(fake, "#!/bin/sh\necho 'Account: some unfamiliar wording'\nexit 0\n");
  chmodSync(fake, 0o755);

  const previous = process.env.CLAUDE_CLI_PATH;
  process.env.CLAUDE_CLI_PATH = fake;
  try {
    const { cliBackend } = await import("../src/lib/llm/cli.ts");
    clearCliFailure();
    const health = await cliBackend.health();
    assert.match(health.detail, /auth status said: Account: some unfamiliar wording/);
  } finally {
    clearCliFailure();
    if (previous === undefined) delete process.env.CLAUDE_CLI_PATH;
    else process.env.CLAUDE_CLI_PATH = previous;
  }
});
