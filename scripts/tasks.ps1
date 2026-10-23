<#
    What this machine is configured to do: its scheduled tasks and its power
    settings, in one place.

    ASCII only -- see the note at the top of setup-appliance.ps1.

    Dot-sourced by two callers, and that is the point. setup-appliance.ps1 uses
    it when a person is setting the machine up; update.ps1 calls it after every
    successful build, so a task added in a commit installs itself.

    Without that second caller, adding a task means running a script on a
    wall-mounted display with no keyboard -- which is the situation this
    repository has already had to solve once for deploys. Registration is
    idempotent (-Force replaces the definition), so running it every build
    costs nothing and drift is impossible.

    It must run AS THE DISPLAY ACCOUNT and NOT ELEVATED. Elevation switches
    user on this machine, and a task registered by the wrong account never runs
    for the right one. The same is true of the power settings, which is how
    they came to be wrong: they were printed as something to run in an
    administrator window, so they configured the elevated account's power plan
    and left the display account on its defaults.
#>

<#
    Never sleep, never blank, while on mains power.

    Applied here rather than printed as a manual step, for two reasons. It has
    to run as the display account -- power schemes are per-user, and an
    administrator window on this machine is a different user -- and `powercfg
    /change` does not need administrator for your own scheme anyway, so there
    was never a reason to send it to one.

    Re-applied on every build because Windows Update resets power plans, and a
    setting that was right once is not the same thing as a setting that is
    right now. It is also cheap: four calls that usually change nothing.

    Only the AC side is set. On battery the Surface should still behave like a
    laptop; it is wall-mounted and permanently plugged in, and a mains failure
    long enough to matter is one where sleeping is the right answer.
#>
function Set-HouseholdPower {
    param([scriptblock] $OnSetting = $null)

    $wanted = @(
        @{ Name = "standby-timeout-ac";   What = "never sleep" },
        @{ Name = "monitor-timeout-ac";   What = "never blank the screen" },
        @{ Name = "disk-timeout-ac";      What = "never spin the disk down" },
        @{ Name = "hibernate-timeout-ac"; What = "never hibernate" }
    )

    foreach ($setting in $wanted) {
        $previous = $ErrorActionPreference
        $ErrorActionPreference = "Continue"
        try {
            $output = & powercfg /change $setting.Name 0 2>&1
            $code = $LASTEXITCODE
        } finally {
            $ErrorActionPreference = $previous
        }
        if ($OnSetting) { & $OnSetting $setting.What ($code -eq 0) ($output | Out-String).Trim() }
    }
}

<#
    Write the two helper scripts the tasks run.

    Here rather than in setup-appliance.ps1, and for the third time the same
    reason: there is no keyboard on the wall. A helper script written once at
    setup can only be changed by somebody typing on that machine, so the fix
    for a scanner that logs nothing was unreachable by the very mechanism
    built to make things reachable. The updater calls this after every build,
    so these two files are whatever the commit says they are.

    Both are overwritten every time. Neither holds state and neither is meant
    to be edited in place -- edit them here.
#>
function Write-HouseholdHelpers {
    param(
        [string] $Root = "C:\household",
        [scriptblock] $OnFile = $null
    )

    # The clone IS the app.
    $app = $Root

    # A .cmd rather than calling npm directly: Task Scheduler does not resolve
    # npm.cmd from PATH reliably, and a one-line wrapper is easier to run by
    # hand when something is wrong.
    $startCmd = Join-Path $Root "household-start.cmd"
    @"
@echo off
rem Started by the "Household app" scheduled task at logon.
rem Written by scripts\tasks.ps1 -- edit it there, not here.
cd /d "$app"
npm start
"@ | Set-Content -Path $startCmd -Encoding ASCII
    if ($OnFile) { & $OnFile $startCmd }

    # The secret is read from .env.local at run time and never written into
    # the task definition, so it does not end up in the Task Scheduler UI.
    #
    # It logs. The previous version wrote its report to stdout from a task
    # registered -WindowStyle Hidden, which means the one subsystem whose
    # whole job is to act unattended was also the only one that never said
    # what it did. A scan that finds nothing and a scan that never ran looked
    # identical from the kitchen.
    $scanPs1 = Join-Path $Root "scan-email.ps1"
    @'
$ErrorActionPreference = "Stop"

# Written by scripts\tasks.ps1 on every build -- edit it there, not here.
$envFile = "C:\household\.env.local"
$log     = "C:\household\scan.log"

function Note($text) {
    $line = "$(Get-Date -Format s)  $text"
    Write-Host $line
    Add-Content -Path $log -Value $line -Encoding UTF8
}

# Every fifteen minutes forever needs a ceiling.
if (Test-Path $log) {
    Set-Content -Path $log -Value (Get-Content -Path $log -Tail 120) -Encoding UTF8
}

try {
    $match = Select-String -Path $envFile -Pattern '^CRON_SECRET=(.+)$'
    if (-not $match) { throw "CRON_SECRET is not set in $envFile" }
    $secret = $match.Matches.Groups[1].Value.Trim()

    # Invoke-WebRequest, not Invoke-RestMethod: the raw body is logged exactly
    # as the server wrote it. Letting PowerShell parse the JSON and re-emit it
    # turns a one-element array into a bare object, which is a parser bug
    # waiting to be blamed on the scanner.
    $response = Invoke-WebRequest -Uri "http://localhost:3000/api/cron/scan-email" `
        -Headers @{ Authorization = "Bearer $secret" } -TimeoutSec 280 -UseBasicParsing
    Note "scanned: $($response.Content)"
} catch {
    # Logged, not swallowed. "The app was still starting" is a real and
    # harmless cause, and it is also indistinguishable from a dead mailbox
    # until somebody can read which one it was.
    Note "failed: $($_.Exception.Message)"
}
'@ | Set-Content -Path $scanPs1 -Encoding UTF8
    if ($OnFile) { & $OnFile $scanPs1 }
}

function Register-HouseholdTasks {
    param(
        [string] $Root = "C:\household",
        # Written to the console by setup-appliance.ps1, silent for the updater.
        [scriptblock] $OnTask = $null
    )

    # The clone IS the app.
    $app = $Root
    $me  = "$env:USERDOMAIN\$env:USERNAME"

    $startCmd = Join-Path $Root "household-start.cmd"
    $scanPs1  = Join-Path $Root "scan-email.ps1"
    $updatePs1 = Join-Path $app "scripts\update.ps1"
    $restPs1   = Join-Path $app "scripts\rest-screen.ps1"

    # Interactive logon type: the task runs as this user when this user is
    # signed in, and needs no stored password. Paired with auto-login that is
    # enough. Limited, because none of these needs administrator.
    $principal = New-ScheduledTaskPrincipal -UserId $me -LogonType Interactive -RunLevel Limited

    function Set-HouseholdTask($name, $action, $triggers, $description, $limit) {
        $settings = New-ScheduledTaskSettingsSet `
            -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
            -StartWhenAvailable -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 2) `
            -ExecutionTimeLimit $limit
        $task = New-ScheduledTask -Action $action -Principal $principal `
            -Trigger $triggers -Settings $settings -Description $description
        Register-ScheduledTask -TaskName $name -InputObject $task -Force | Out-Null
        if ($OnTask) { & $OnTask $name }
    }

    $forever = New-TimeSpan -Hours 0

    Set-HouseholdTask "Household app" `
        (New-ScheduledTaskAction -Execute $startCmd) `
        (New-ScheduledTaskTrigger -AtLogOn -User $me) `
        "Starts the household dashboard when the display account signs in." `
        $forever

    # A repetition with no duration has meant "one day" on some Windows builds
    # and "forever" on others; ten years is unambiguous on all of them.
    $scanTrigger = New-ScheduledTaskTrigger -Once -At (Get-Date).Date.AddMinutes(5) `
        -RepetitionInterval (New-TimeSpan -Minutes 15) `
        -RepetitionDuration (New-TimeSpan -Days 3650)
    Set-HouseholdTask "Household email scan" `
        (New-ScheduledTaskAction -Execute "powershell.exe" `
            -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$scanPs1`"") `
        $scanTrigger `
        "Reads every connected mailbox and files what it finds." `
        $forever

    # Every ten minutes, and almost always a no-op: it compares two hashes and
    # stops. The display is wall-mounted with no keyboard, so this is how a
    # change gets there -- and because the task is not the app, it still works
    # when a bad build has taken the app down.
    $updateTrigger = New-ScheduledTaskTrigger -Once -At (Get-Date).Date.AddMinutes(3) `
        -RepetitionInterval (New-TimeSpan -Minutes 10) `
        -RepetitionDuration (New-TimeSpan -Days 3650)
    Set-HouseholdTask "Household update" `
        (New-ScheduledTaskAction -Execute "powershell.exe" `
            -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$updatePs1`"") `
        $updateTrigger `
        "Pulls the tracked branch, rebuilds and restarts the app when it moves." `
        $forever

    # 11pm to 5am, screen only: the machine stays up so the scan and the updater
    # keep running. Six hours rather than two because the argument is thermal as
    # much as it is hours -- the backlight driver's capacitors age with heat --
    # and because the script yields to anyone actually using the wall, so a long
    # window costs nothing.
    #
    # Capped at seven so a stuck run cannot hold the wall dark through
    # breakfast; ending the task runs the script's finally, which turns the
    # display back on.
    Set-HouseholdTask "Household screen rest" `
        (New-ScheduledTaskAction -Execute "powershell.exe" `
            -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$restPs1`" -Minutes 360") `
        (New-ScheduledTaskTrigger -Daily -At ([datetime]::Today.AddHours(23))) `
        "Rests the display between 11pm and 5am. The app keeps running." `
        (New-TimeSpan -Hours 7)

    $tailscale = "C:\Program Files\Tailscale\tailscale.exe"
    if (Test-Path $tailscale) {
        Set-HouseholdTask "Household tunnel" `
            (New-ScheduledTaskAction -Execute $tailscale -Argument "serve --bg 3000") `
            (New-ScheduledTaskTrigger -AtLogOn -User $me) `
            "Re-applies the Tailscale HTTPS proxy to the app." `
            $forever
    }
}
