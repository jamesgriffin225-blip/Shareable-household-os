<#
    Give the panel the night off.

    ASCII only -- see the note at the top of setup-appliance.ps1.

    The display is a 2017 Surface that has been lit continuously since
    `powercfg /change monitor-timeout-ac 0` made sure it never blanked. This
    rests it between 11pm and 5am -- a quarter of the year's lit hours.

    Hours are not the main argument, though. An ageing backlight dims and
    shifts colour; it does not flicker. Flicker after long uptime points at the
    driver board, where electrolytic capacitors fail from heat rather than from
    hours, and their life roughly doubles for every ten degrees cooler they
    run. Six hours of genuine cool-down a night is worth more to that board
    than the arithmetic on backlight hours suggests.

    The machine deliberately stays awake. Sleeping it would stop the
    fifteen-minute mailbox scan and the ten-minute updater, and on this
    hardware generation resume is the least reliable thing it does. Shutting it
    down is worse still: a Surface cannot power itself back on -- its firmware
    has no wake alarm -- so 2am would mean a dark wall until somebody pressed
    the button.

    Touching the screen during the window turns it straight back on and keeps
    it on while you are there, which is what you want at 3am with a baby. It
    goes dark again a couple of minutes after you stop.
#>

param(
    # How long the window lasts. The task supplies this; the default matches.
    [int] $Minutes = 360,

    # How long the wall must be left alone before the screen goes dark again.
    # Short enough to be worth having, long enough that reading the week does
    # not get you blanked mid-sentence.
    [int] $IdleSeconds = 120
)

$ErrorActionPreference = "Stop"

$log = "C:\household\screen-rest.log"

function Note($text) {
    $line = "$(Get-Date -Format s)  $text"
    Write-Host $line
    Add-Content -Path $log -Value $line -Encoding UTF8
}

if (Test-Path $log) {
    Set-Content -Path $log -Value (Get-Content -Path $log -Tail 100) -Encoding UTF8
}

# There is no managed API for either half of this.
#
# Turning the display off is a broadcast WM_SYSCOMMAND. Turning it back on by
# sending the same message with -1 is documented but unreliable in practice, so
# the wake is a zero-distance mouse move instead: Windows counts that as user
# input, which is the thing it actually responds to, and a delta of nothing
# leaves the pointer where it was.
Add-Type -Namespace Household -Name Screen -MemberDefinition @'
    [System.Runtime.InteropServices.DllImport("user32.dll")]
    public static extern int SendMessage(int hWnd, int hMsg, int wParam, int lParam);

    [System.Runtime.InteropServices.DllImport("user32.dll")]
    public static extern void mouse_event(int flags, int dx, int dy, int data, int extra);

    [System.Runtime.InteropServices.StructLayout(System.Runtime.InteropServices.LayoutKind.Sequential)]
    public struct LASTINPUTINFO { public uint cbSize; public uint dwTime; }

    [System.Runtime.InteropServices.DllImport("user32.dll")]
    public static extern bool GetLastInputInfo(ref LASTINPUTINFO info);

    /// Seconds since anything was touched in this session.
    public static double IdleSeconds() {
        LASTINPUTINFO info = new LASTINPUTINFO();
        info.cbSize = (uint)System.Runtime.InteropServices.Marshal.SizeOf(info);
        if (!GetLastInputInfo(ref info)) return 0;
        // Both are 32-bit tick counts that wrap after 49 days of uptime; the
        // unchecked subtraction is correct across the wrap, a plain one is not.
        unchecked { return (double)((uint)System.Environment.TickCount - info.dwTime) / 1000.0; }
    }
'@

$HWND_BROADCAST  = 0xFFFF
$WM_SYSCOMMAND   = 0x0112
$SC_MONITORPOWER = 0xF170
$MONITOR_OFF     = 2
$MOUSEEVENTF_MOVE = 0x0001

function Stop-Display() {
    [Household.Screen]::SendMessage($HWND_BROADCAST, $WM_SYSCOMMAND, $SC_MONITORPOWER, $MONITOR_OFF) | Out-Null
}

function Start-Display() {
    [Household.Screen]::mouse_event($MOUSEEVENTF_MOVE, 0, 0, 0, 0)
}

$until = (Get-Date).AddMinutes($Minutes)
Note "screen resting until $($until.ToString("HH:mm"))"

try {
    <#
        An ordinary screen timeout, in force only during the window.

        The first version re-asserted the off every 55 seconds no matter what,
        which is fine at 2am and wrong at 11pm: standing at the wall using it,
        you would be blanked every minute. Asking Windows how long the session
        has been idle costs nothing and makes the behaviour the one everybody
        already understands -- touch it, use it for as long as you like, and it
        goes dark a couple of minutes after you walk away.

        Re-asserting is still needed, because this machine's digitiser raises
        the occasional phantom touch; that just means it goes off again after
        the grace period rather than staying lit until morning.
    #>
    while ((Get-Date) -lt $until) {
        if ([Household.Screen]::IdleSeconds() -ge $IdleSeconds) { Stop-Display }
        Start-Sleep -Seconds 20
    }
} finally {
    # In a finally so that stopping the task by hand does not leave the wall
    # dark with no obvious way to get it back.
    Start-Display
    Note "screen back on"
}
