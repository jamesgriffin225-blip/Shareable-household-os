import assert from "node:assert/strict";
import { test } from "node:test";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { claudeLoginState, findLoginUrl, startClaudeLogin } from "../src/lib/claude-login.ts";

test("the sign-in URL is picked out of whatever the CLI prints", () => {
  assert.equal(
    findLoginUrl("Opening browser...\nhttps://claude.ai/oauth/authorize?code=abc123\n"),
    "https://claude.ai/oauth/authorize?code=abc123",
  );
  // Trailing punctuation is not part of a URL.
  assert.equal(findLoginUrl("Visit (https://claude.ai/x) to finish."), "https://claude.ai/x");
  assert.equal(findLoginUrl("no url here"), null);
});

test("starting a sign-in captures the URL for the wall", async () => {
  const dir = mkdtempSync(join(tmpdir(), "claude-login-"));
  const fake = join(dir, "claude");
  writeFileSync(
    fake,
    "#!/bin/sh\necho 'Opening browser to https://claude.ai/oauth/authorize?x=1'\nsleep 1\nexit 0\n",
  );
  chmodSync(fake, 0o755);

  const previous = process.env.CLAUDE_CLI_PATH;
  process.env.CLAUDE_CLI_PATH = fake;
  try {
    const result = await startClaudeLogin();
    assert.equal(result.started, true);
    const state = claudeLoginState();
    assert.equal(state.url, "https://claude.ai/oauth/authorize?x=1");
    assert.equal(state.running, false, "the fake exits, so the flow is over");
    assert.equal(state.succeeded, true);
  } finally {
    if (previous === undefined) delete process.env.CLAUDE_CLI_PATH;
    else process.env.CLAUDE_CLI_PATH = previous;
  }
});

test("a sign-in that cannot start says so rather than appearing to wait", async () => {
  const previous = process.env.CLAUDE_CLI_PATH;
  process.env.CLAUDE_CLI_PATH = "/nonexistent/claude";
  try {
    await startClaudeLogin();
    const state = claudeLoginState();
    assert.equal(state.running, false);
    assert.equal(state.succeeded, false);
    assert.match(state.output, /Could not run|ENOENT/);
  } finally {
    if (previous === undefined) delete process.env.CLAUDE_CLI_PATH;
    else process.env.CLAUDE_CLI_PATH = previous;
  }
});

test("the endpoint takes no command, only go", () => {
  // Same rule as the update button: this starts one fixed subprocess, so
  // nothing from a request can reach a command line.
  const route = readFileSync(
    new URL("../src/app/api/settings/claude-login/route.ts", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(route, /request\.json\(\)/, "POST should read no body at all");
  const lib = readFileSync(new URL("../src/lib/claude-login.ts", import.meta.url), "utf8");
  assert.match(lib, /spawn\(binary\(\), \["auth", "login"\]/, "fixed arguments only");
});
