import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { deployable, readDeployState, startDeploy } from "../src/lib/deploy.ts";

test("the update button is only offered where the task that does the work exists", () => {
  assert.equal(deployable(), process.platform === "win32");
});

test("asking to update anywhere but the wall does nothing and says why", async () => {
  if (deployable()) return;
  const result = await startDeploy();
  assert.equal(result.started, false);
  assert.match(result.detail, /only works on the wall/);
});

test("no caller input can reach a shell", () => {
  // The endpoint's whole safety argument is that the request body is not part
  // of any command: the button starts one named scheduled task. A parameter
  // here would be the first step towards a remote shell on the house.
  assert.equal(startDeploy.length, 0);

  const source = readFileSync(new URL("../src/lib/deploy.ts", import.meta.url), "utf8");
  // Arguments reach the process as an array, so there is no shell to inject
  // into. `exec` — or a command assembled in a template literal — would put
  // one back, which is the shape this test exists to catch.
  const imported = source.match(/import \{([^}]*)\} from "node:child_process"/)?.[1] ?? "";
  assert.match(imported, /execFile/);
  assert.doesNotMatch(imported, /(^|[^a-zA-Z])exec([^a-zA-Z]|$)/, "use execFile, not exec");
  assert.doesNotMatch(source, /\bspawn|\bshell\s*:/, "no shell, by any route");
  assert.doesNotMatch(source, /run\(`/, "commands are literals, never templates");
});

test("it reports the checkout it is running from", async () => {
  const state = await readDeployState();
  assert.equal(state.available, deployable());
  // This repository is a git checkout, so these are readable here too.
  assert.match(state.commit ?? "", /^[0-9a-f]{7,}$/);
  assert.ok((state.subject ?? "").length > 0);
  assert.ok(Array.isArray(state.log));
  // "Up to date" is a claim with a time on it, and the screen says which.
  assert.ok(state.checkedAt === null || !Number.isNaN(Date.parse(state.checkedAt)));
});

test("the script keeps the timeline and the build noise apart", () => {
  const script = readFileSync(new URL("../scripts/update.ps1", import.meta.url), "utf8");
  // A build writes thousands of lines of table. Sharing one file with the
  // timeline buried it, and the phone showed the tail of a webpack report
  // instead of what happened.
  assert.match(script, /\$buildLog\s*=/);
  assert.match(script, /Add-Content -Path \$buildLog/);
  // The log a phone reads must not be written as ASCII: next build prints box
  // drawing, and ASCII turns every one of those into a question mark.
  assert.doesNotMatch(script, /Add-Content[^\n]*-Encoding ASCII/);
  assert.doesNotMatch(script, /Set-Content -Path \$log[^\n]*-Encoding ASCII/);
});
