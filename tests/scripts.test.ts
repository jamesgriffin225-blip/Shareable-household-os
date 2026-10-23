import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = new URL("../scripts/", import.meta.url).pathname;
const scripts = readdirSync(dir).filter((name) => name.endsWith(".ps1"));

test("there are PowerShell scripts to check", () => {
  assert.ok(scripts.length > 0);
});

/**
 * Windows PowerShell 5.1 reads a .ps1 as ANSI unless it carries a byte-order
 * mark, so a UTF-8 em dash arrives as three mojibake characters and the parser
 * dies -- reporting a missing brace eighty lines further down. House style
 * loses to the parser here, and this is cheaper than finding out on the wall.
 */
for (const name of scripts) {
  test(`${name} is pure ASCII`, () => {
    const source = readFileSync(join(dir, name), "utf8");
    const offenders = [...source.matchAll(/[^\x09\x0a\x0d\x20-\x7e]/g)].map((match) => {
      const line = source.slice(0, match.index).split("\n").length;
      return `line ${line}: ${JSON.stringify(match[0])}`;
    });
    assert.deepEqual(offenders, [], `non-ASCII in ${name}`);
  });
}


test("scheduled tasks are defined once, and the updater installs them", () => {
  const read = (name: string) =>
    readFileSync(new URL(`../scripts/${name}`, import.meta.url), "utf8");

  // Registration lives in tasks.ps1 alone. Two copies means the machine with
  // no keyboard keeps whichever one the updater happens to call.
  const tasks = read("tasks.ps1");
  assert.match(tasks, /function Register-HouseholdTasks/);
  for (const name of ["setup-appliance.ps1", "update.ps1"]) {
    const script = read(name);
    assert.match(script, /Register-HouseholdTasks/, `${name} should call the shared function`);
    assert.doesNotMatch(
      script,
      /Register-ScheduledTask\b/,
      `${name} should not register tasks of its own`,
    );
  }

  // The updater is how a new task reaches a display nobody can type on, so it
  // has to dot-source the file and must not let a failure there kill a build
  // that otherwise worked.
  const updater = read("update.ps1");
  assert.match(updater, /\.\s*\(Join-Path \$app "scripts\\tasks\.ps1"\)/);
  // The whole machine-configuration block, however many calls it grows: from
  // the dot-source to the restart that follows it. Measured by its boundaries
  // rather than a character count, which a comment can push past.
  const start = updater.indexOf('scripts\\tasks.ps1');
  const end = updater.indexOf('Trace "stopping the app"', start);
  assert.ok(end > start, "the restart should still follow the configuration block");
  assert.match(updater.slice(start, end), /\}\s*catch\s*\{/, "registration must not be fatal");
});

test("the machine configuration is applied before the nothing-to-build exit", () => {
  // PowerShell parses a .ps1 in full before running it, so the run that
  // deploys a change to update.ps1 is still executing the previous version.
  // A call added to the configuration block does nothing on the build that
  // delivers it -- and if the block sits after the early exit, the next run
  // has nothing to build and never reaches it either. That shipped a commit
  // the machine never applied, with both logs reporting success.
  const updater = readFileSync(new URL("../scripts/update.ps1", import.meta.url), "utf8");
  const config = updater.indexOf("Write-HouseholdHelpers");
  const exit = updater.indexOf("exit 0");
  assert.ok(config > 0, "the updater should apply the machine configuration");
  assert.ok(exit > 0, "the quiet path should still exit early");
  assert.ok(config < exit, "configuration must come before the early exit");

  // And after the fast-forward, or it applies the previous commit's.
  const merge = updater.indexOf('"fast-forwarding"');
  assert.ok(merge > 0 && merge < config, "configuration must follow the merge");
});

test("the nightly rest turns the screen off, and always turns it back on", () => {
  const rest = readFileSync(new URL("../scripts/rest-screen.ps1", import.meta.url), "utf8");
  // SC_MONITORPOWER off, re-asserted in a loop, and the wake in a finally so
  // that killing the task cannot leave the wall dark until somebody notices.
  assert.match(rest, /0xF170/);
  assert.match(rest, /while \(\(Get-Date\) -lt \$until\)/);
  assert.match(rest, /finally \{[\s\S]*Start-Display/);
  // It must not power the machine down: a Surface has no wake alarm, so 11pm
  // would mean a dark wall until somebody pressed the button.
  assert.doesNotMatch(rest, /Stop-Computer|shutdown\.exe|SetSuspendState/i);
});

test("the rest window yields to anyone actually using the wall", () => {
  const rest = readFileSync(new URL("../scripts/rest-screen.ps1", import.meta.url), "utf8");
  // Six hours spans the part of the evening somebody may still be standing at
  // it, so the off is conditional on the session being idle rather than
  // re-asserted blindly -- otherwise using the wall at 11pm means being
  // blanked every minute.
  assert.match(rest, /GetLastInputInfo/);
  assert.match(rest, /IdleSeconds\(\) -ge \$IdleSeconds.*Stop-Display/);
  // TickCount wraps after 49 days of uptime, and this machine is never
  // rebooted on purpose.
  assert.match(rest, /unchecked/);
});

test("the rest task covers the window it claims to", () => {
  const tasks = readFileSync(new URL("../scripts/tasks.ps1", import.meta.url), "utf8");
  const block = tasks.slice(tasks.indexOf('"Household screen rest"'));
  const minutes = Number(/-Minutes (\d+)/.exec(block)?.[1]);
  const startHour = Number(/AddHours\((\d+)\)/.exec(block)?.[1]);
  const limitHours = Number(/New-TimeSpan -Hours (\d+)/.exec(block)?.[1]);
  assert.equal(startHour, 23);
  assert.equal(minutes, 360, "11pm to 5am");
  // Long enough to finish, short enough that a stuck run cannot hold the wall
  // dark through breakfast.
  assert.ok(limitHours > minutes / 60, "the time limit must outlast the window");
  assert.ok(limitHours <= 8, "but not by much");
});


/**
 * Hand the scripts to a real PowerShell parser, when one is on this machine.
 *
 * Reading them is not enough. `tasks.ps1` writes `scan-email.ps1` out of a
 * here-string, so the outer file parsing cleanly says nothing at all about
 * the script it generates -- and that generated script runs unattended on a
 * display with no keyboard, where a syntax error surfaces as a scan that
 * quietly never happens.
 *
 * Skipped where PowerShell is absent, which is most development machines.
 * Set PWSH to a pwsh binary, or put one on PATH, to turn it on:
 *
 *     PWSH=/path/to/pwsh npm test
 */
function pwsh(): string | null {
  for (const candidate of [process.env.PWSH, "pwsh"]) {
    if (!candidate) continue;
    try {
      execFileSync(candidate, ["-NoProfile", "-Command", "$PSVersionTable.PSVersion.Major"], {
        stdio: "ignore",
      });
      return candidate;
    } catch {
      // Not here, or not runnable. Try the next.
    }
  }
  return null;
}

const PARSE = `
  $bad = 0
  Get-ChildItem -Path $args[0] -Filter *.ps1 | ForEach-Object {
    $errors = $null
    [void][System.Management.Automation.Language.Parser]::ParseFile($_.FullName, [ref]$null, [ref]$errors)
    if ($errors -and $errors.Count -gt 0) {
      $bad++
      Write-Output "$($_.Name): $($errors[0].Extent.StartLineNumber): $($errors[0].Message)"
    }
  }
  exit $bad
`;

const shell = pwsh();

test("every script parses as PowerShell", { skip: shell ? false : "no pwsh on this machine" }, () => {
  const dir = new URL("../scripts/", import.meta.url).pathname;
  const output = execFileSync(shell!, ["-NoProfile", "-Command", PARSE, dir], { encoding: "utf8" });
  assert.equal(output.trim(), "", output);
});

test("the script tasks.ps1 generates parses too", { skip: shell ? false : "no pwsh on this machine" }, () => {
  // The one that actually runs unattended, and the one a here-string can
  // break without the file containing it noticing.
  const root = mkdtempSync(join(tmpdir(), "household-helpers-"));
  const tasks = new URL("../scripts/tasks.ps1", import.meta.url).pathname;
  execFileSync(
    shell!,
    ["-NoProfile", "-Command", `. '${tasks}'; Write-HouseholdHelpers -Root '${root}'`],
    { encoding: "utf8" },
  );

  const written = readdirSync(root);
  assert.ok(written.includes("scan-email.ps1"), `expected a scanner, got ${written.join(", ")}`);
  assert.ok(written.includes("household-start.cmd"));

  const output = execFileSync(shell!, ["-NoProfile", "-Command", PARSE, root], { encoding: "utf8" });
  assert.equal(output.trim(), "", output);

  // It has to write the log, or none of this is visible from the kitchen.
  const scanner = readFileSync(join(root, "scan-email.ps1"), "utf8");
  assert.match(scanner, /Add-Content -Path \$log/);
  assert.match(scanner, /scan\.log/);
});
