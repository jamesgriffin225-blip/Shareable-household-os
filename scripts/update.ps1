<#
    Bring the wall up to date with the branch it is tracking.

    ASCII only -- see the note at the top of setup-appliance.ps1. Windows
    PowerShell 5.1 reads a .ps1 as ANSI, and one stray em dash kills the parse
    with an error pointing somewhere else.

    Run by the "Household update" scheduled task every ten minutes, and by the
    Update button in Settings. Safe to run as often as you like: with nothing
    new it fetches, re-applies the machine configuration, compares two hashes
    and stops without writing a line.

    It exists because the display is wall-mounted with no keyboard. The task is
    deliberately independent of the app: if a bad build takes the app down, the
    fix is to push a good one and wait -- nothing on this machine has to be
    touched, which is the whole point.

    Run it by hand the first time, in a window where you can see it:

        powershell -ExecutionPolicy Bypass -File C:\household\household\scripts\update.ps1 -Force
#>

param(
    # Build and restart even when the commit has not moved, for getting back to
    # a known state by hand.
    [switch] $Force
)

$ErrorActionPreference = "Stop"

$root   = "C:\household"
# The clone IS the app: this repository's root is the Next.js project, so
# $app and $root are the same directory.
$app    = $root
# Two logs, because they have two readers.
#
#   update.log       the timeline: what it did and when. Short enough that a
#                    phone can show the tail of it and learn something.
#   update-build.log npm and next in full. Thousands of lines of table, which
#                    buried the timeline completely when they shared a file.
#
# On a failure the tail of the noisy one is copied into the timeline, so a
# broken build can still be diagnosed from a phone.
$log      = Join-Path $root "update.log"
$buildLog = Join-Path $root "update-build.log"
$marker   = Join-Path $root "built-commit.txt"

# A credential prompt inside a hidden scheduled task is a job that hangs until
# somebody notices the wall has gone stale. Fail instead, and say so.
#
# GIT_TERMINAL_PROMPT only covers the terminal. Git Credential Manager opens a
# WINDOW, which a hidden scheduled task can never show and a person at the
# console may never see behind the PowerShell window -- so it waits forever
# either way. GCM_INTERACTIVE=never makes it fail instead, which at least says
# something.
$env:GIT_TERMINAL_PROMPT = "0"
$env:GCM_INTERACTIVE = "never"

# Kept: the events worth reading back from a phone later.
#
# UTF8, not ASCII: the script file has to be ASCII for PowerShell 5.1 to parse
# it, but what it writes does not, and -Encoding ASCII turned every box-drawing
# character next build prints into a literal question mark.
function Note($text) {
    $line = "$(Get-Date -Format s)  $text"
    Write-Host $line
    Add-Content -Path $log -Value $line -Encoding UTF8
}

# Not kept: progress for whoever is watching this run happen. Every step says
# what it is about to do BEFORE it does it, because the two things that take
# minutes here are also the two that print nothing while they work, and
# "working" and "hung" look identical from a chair.
function Trace($text) {
    Write-Host "$(Get-Date -Format "HH:mm:ss")  $text" -ForegroundColor DarkGray
}

# Keep both to a size worth opening.
if (Test-Path $log) {
    Set-Content -Path $log -Value (Get-Content -Path $log -Tail 200) -Encoding UTF8
}
if (Test-Path $buildLog) { Remove-Item $buildLog -Force }

# A scheduled task does not inherit your shell's PATH. The README already
# records this trap for claude.cmd; it applies just as well to these two.
function Resolve-Tool($names) {
    foreach ($name in $names) {
        $found = Get-Command $name -ErrorAction SilentlyContinue
        if ($found) { return $found.Source }
    }
    throw "none of '$($names -join ", ")' is on PATH for this task"
}

<#
    Run a native command without PowerShell turning its chatter into an error.

    With $ErrorActionPreference = "Stop", `2>&1` on a native command makes the
    first line it writes to stderr a terminating error. git writes fetch and
    merge progress to stderr, and npm writes almost everything there, so the
    strict setting that protects the rest of this script would fail every run
    at the first perfectly normal line of output.
#>
function Invoke-Tool($exe, $toolArgs) {
    $previous = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        $output = & $exe @toolArgs 2>&1
    } finally {
        $ErrorActionPreference = $previous
    }
    return [pscustomobject]@{
        Code = $LASTEXITCODE
        Text = ($output | Out-String).Trim()
    }
}

<#
    The same, for the two commands that take minutes.

    Capturing their output into a variable means the console shows nothing at
    all while npm works -- on this hardware that is several silent minutes, and
    silence is indistinguishable from a hang. This streams each line as it
    arrives, to the console for whoever is watching and to the build log for
    afterwards.
#>
function Invoke-ToolStreaming($exe, $toolArgs) {
    $previous = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        & $exe @toolArgs 2>&1 | ForEach-Object {
            $line = "$_"
            Write-Host $line
            Add-Content -Path $buildLog -Value $line -Encoding UTF8
        }
        return $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $previous
    }
}

# Put the end of the build output where the phone can see it. Only on a
# failure: this is the one time the noise is the answer.
function Copy-BuildTail() {
    if (-not (Test-Path $buildLog)) { return }
    foreach ($line in (Get-Content -Path $buildLog -Tail 20)) {
        Add-Content -Path $log -Value "    $line" -Encoding UTF8
    }
}

try {
    Trace "looking for git and npm"
    $git = Resolve-Tool @("git.exe", "git")
    $npm = Resolve-Tool @("npm.cmd", "npm")

    function Git($toolArgs, $what) {
        $result = Invoke-Tool $git (@("-C", $root) + $toolArgs)
        if ($result.Code -ne 0) { throw "$what failed: $($result.Text)" }
        return $result.Text
    }

    $branch = Git @("rev-parse", "--abbrev-ref", "HEAD") "reading the branch"

    # The first thing here that touches the network, and so the first thing
    # that can sit waiting on a credential. Said out loud for that reason.
    Trace "fetching origin/$branch"
    # A stalled transfer gives up after a minute instead of waiting forever:
    # one hung fetch is what held this task "running" for two weeks.
    Git @("-c", "http.lowSpeedLimit=1000", "-c", "http.lowSpeedTime=60", "fetch", "--quiet", "origin", $branch) "fetching $branch" | Out-Null

    $head   = Git @("rev-parse", "HEAD") "reading HEAD"
    $remote = Git @("rev-parse", "origin/$branch") "reading origin/$branch"

    if ($head -ne $remote) {
        Note "pulling $branch  $($head.Substring(0, 7)) -> $($remote.Substring(0, 7))"
        # Fast-forward only. A merge commit created unattended on a wall is a
        # state nobody can see and nobody asked for.
        Git @("merge", "--ff-only", "origin/$branch") "fast-forwarding" | Out-Null
        $head = Git @("rev-parse", "HEAD") "reading HEAD"
    }

    <#
        Everything this machine is configured to be, applied now.

        BEFORE the "nothing to build" exit, and that placement is the whole
        point. PowerShell parses a .ps1 in full before running a line of it,
        so the run that deploys a change to THIS file is still executing the
        previous version of it. A new call added here therefore does nothing
        on the build that delivers it, and the next run -- having nothing to
        build -- used to exit before reaching it. The result was a commit that
        shipped and a machine that never applied it, with both logs saying the
        update had worked.

        Cheap enough to do every ten minutes: two small files rewritten, five
        idempotent task definitions, four powercfg calls that usually change
        nothing. Never fatal, and silent on success -- the quiet path stays
        quiet.
    #>
    try {
        . (Join-Path $app "scripts\tasks.ps1")
        Write-HouseholdHelpers -Root $root
        Register-HouseholdTasks -Root $root
        Set-HouseholdPower
        Trace "helper scripts, scheduled tasks and power settings are current"
    } catch {
        Note "could not apply the machine configuration: $($_.Exception.Message)"
    }

    Trace "at $($head.Substring(0, 7)); checking what was last built"
    $built = ""
    if (Test-Path $marker) {
        $saved = Get-Content -Path $marker -Raw
        if ($saved) { $built = $saved.Trim() }
    }

    if ($head -eq $built -and -not $Force) {
        # The quiet path, which is almost every run. Nothing is logged on
        # purpose: ten minutes of "nothing to do" forever would bury the runs
        # that mattered.
        exit 0
    }

    $subject = Git @("log", "-1", "--format=%s") "reading the commit message"
    Note "building $($head.Substring(0, 7))  $subject"

    # Dependencies only when the lockfile actually moved: npm ci deletes
    # node_modules and takes minutes, and the common change does not need it.
    # A built commit we can no longer diff against (rebased away, or a fresh
    # checkout) is treated as "install", because guessing wrong the other way
    # produces a build that fails on a missing package.
    $needsInstall = $true
    if ($built -ne "" -and (Test-Path (Join-Path $app "node_modules"))) {
        $diff = Invoke-Tool $git @("-C", $root, "diff", "--name-only", $built, $head, "--", "package-lock.json")
        $needsInstall = ($diff.Code -ne 0) -or ($diff.Text -ne "")
    }

    $started = Get-Date
    Push-Location $app
    try {
        if ($needsInstall) {
            # --no-audit --no-fund: two network round trips and a paragraph of
            # output that have nothing to do with whether the build works.
            Note "npm ci (a few minutes on this machine)"
            if ((Invoke-ToolStreaming $npm @("ci", "--no-audit", "--no-fund")) -ne 0) {
                throw "npm ci failed"
            }
        }

        Note "next build (a few minutes on this machine)"
        if ((Invoke-ToolStreaming $npm @("run", "build")) -ne 0) { throw "build failed" }
    } finally {
        Pop-Location
    }
    Note "built in $([int]((Get-Date) - $started).TotalSeconds)s"

    Set-Content -Path $marker -Value $head -Encoding ASCII

    Trace "stopping the app"
    Note "restarting the app"
    Stop-ScheduledTask -TaskName "Household app" -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 3

    # Stop-ScheduledTask does not always take the whole tree with it: the task
    # runs a .cmd, which runs npm, which runs node, and it is node that holds
    # the port. Kill by what is listening, never by process name -- this
    # machine also runs a signed-in Claude Code, which is node too.
    $owner = Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue |
        Select-Object -First 1 -ExpandProperty OwningProcess
    if ($owner) {
        Note "port 3000 still held by pid $owner; stopping it"
        Stop-Process -Id $owner -Force -ErrorAction SilentlyContinue
        Start-Sleep -Seconds 2
    }

    Start-ScheduledTask -TaskName "Household app"
    Note "done"
} catch {
    Note "FAILED: $($_.Exception.Message)"
    Copy-BuildTail
    exit 1
}
