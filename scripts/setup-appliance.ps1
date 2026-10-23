<#
    Turn the Surface into an appliance.

    ASCII only, deliberately. Windows PowerShell 5.1 reads a .ps1 as ANSI
    unless it carries a byte-order mark, so a UTF-8 em dash arrives as three
    mojibake characters and the parser dies on the line it is in -- with an
    error pointing at something else entirely. Keep every character in this
    file below 128.

    Run this AS THE ACCOUNT THAT RUNS THE WALL DISPLAY (Home), in an ORDINARY
    PowerShell window -- not "Run as administrator". Elevation switches to a
    different account here, and a scheduled task registered by the admin account does not
    run for Home. That mismatch has already cost us an afternoon once.

    Everything it does lives in tasks.ps1, so that the updater can do the
    same thing after every build on a machine with no keyboard:
      * household-start.cmd   -- starts the app, used by the logon task
      * scan-email.ps1        -- pokes the scan endpoint and logs what it said
      * the scheduled tasks -- the app at logon, the mailbox scan, the
        self-deploy, the nightly screen rest, the tunnel
      * the power settings: never sleep, never blank, on mains

    The two parts that genuinely need administrator -- folder ownership and
    the Windows Update hours -- are printed at the end to run separately,
    rather than silently doing half the job from the wrong account.
#>

$ErrorActionPreference = "Stop"

$root    = "C:\household"
# The clone IS the app: this repository's root is the Next.js project, so
# $app and $root are the same directory.
$app     = $root
$envFile = Join-Path $app ".env.local"
$me      = "$env:USERDOMAIN\$env:USERNAME"

function Say($text) { Write-Host $text }
function Ok($text)  { Write-Host "  ok   $text" -ForegroundColor Green }
function Warn($text){ Write-Host "  warn $text" -ForegroundColor Yellow }

Say ""
Say "Setting this machine up as the household display, as $me"
Say ""

if (-not (Test-Path $app))     { throw "No app at $app -- is the repo cloned somewhere else?" }
if (-not (Test-Path $envFile)) { throw "No .env.local at $envFile -- the app cannot start without it." }

# ------------------------------------------------------------------ tasks
# Defined in tasks.ps1, which update.ps1 also calls after every build -- so a
# task added in a commit installs itself on a machine with no keyboard.
. (Join-Path $app "scripts\tasks.ps1")

try {
    Write-HouseholdHelpers -Root $root -OnFile { param($path) Ok "wrote $path" }
    Register-HouseholdTasks -Root $root -OnTask { param($name) Ok "task `"$name`"" }
    Set-HouseholdPower -OnSetting {
        param($what, $ok, $detail)
        if ($ok) { Ok $what } else { Warn "could not set $what -- $detail" }
    }
} catch {
    Warn "Could not register a task: $($_.Exception.Message)"
    Warn "If this says access denied, you are probably in an elevated window as the wrong account."
    throw
}

Say ""
Say "Done. Bring the app to the current commit now, without waiting:"
Say "  powershell -ExecutionPolicy Bypass -File $app\scripts\update.ps1 -Force"
Say ""
Say "After that the wall deploys itself: push to the branch it tracks and it"
Say "picks the change up within ten minutes. Settings has an Update button and"
Say "shows what it is running, so you can watch from a phone."
Say ""
Say "-------------------------------------------------------------------"
Say "The rest needs an ADMINISTRATOR window. Run these there:"
Say ""
Say "  # hand the repo to $me so git stops refusing to pull"
Say "  icacls $root /setowner `"$me`" /T /C"
Say ""
Say "  # do not reboot for updates between 6am and 11pm"
Say "  Set-ItemProperty 'HKLM:\SOFTWARE\Microsoft\WindowsUpdate\UX\Settings' ActiveHoursStart 6"
Say "  Set-ItemProperty 'HKLM:\SOFTWARE\Microsoft\WindowsUpdate\UX\Settings' ActiveHoursEnd 23"
Say ""
Say "Auto-login is the one thing to do by hand, because it involves your"
Say "password: run  netplwiz , untick 'Users must enter a user name and"
Say "password', and enter the $env:USERNAME password when asked. Windows keeps"
Say "it as an LSA secret rather than in the registry in plain text."
Say "-------------------------------------------------------------------"
Say ""
