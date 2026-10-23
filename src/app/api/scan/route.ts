import { readScanState } from "@/lib/scan-log";
import { liveScan, startLiveScan } from "@/lib/scan-run";
import { handle, json } from "@/lib/http";

export const dynamic = "force-dynamic";

/**
 * What the mailbox scanner last found, and a way to run it now.
 *
 * Two sources, and the screen needs both. The scheduled task scans every
 * fifteen minutes whether or not the app is healthy, and leaves its report in
 * `scan.log`. The button runs one here, in this process, and reports back
 * directly -- including the error, which is the thing that was invisible
 * through three attempts at finding it.
 *
 * A live result wins when there is one, because it is the fresher of the two
 * and the one a person just asked for.
 */
export async function GET() {
  try {
    const [logged, live] = [await readScanState(), liveScan()];
    if (live.result) {
      return json({
        ...logged,
        ...live.result,
        running: live.running,
        startedAt: live.startedAt,
      });
    }
    return json({ ...logged, running: live.running, startedAt: live.startedAt });
  } catch (error) {
    return handle(error);
  }
}

/**
 * Two runs, and the body chooses which -- not a command, a flag.
 *
 * A filing scan is the ordinary one. An inspection re-reads a fixed window,
 * says what the model makes of each message and changes nothing: no
 * execution, no approval queued, no claim taken, no watermark moved. It
 * exists because the normal path gives a message exactly one chance, and by
 * the time anyone asks why nothing happened that chance is spent.
 */
export async function POST(request: Request) {
  try {
    let inspect = false;
    try {
      const body = (await request.json()) as { inspect?: unknown };
      inspect = body?.inspect === true;
    } catch {
      // No body is the ordinary scan, which is what the button sent before
      // there was a second one.
    }
    // Started, not awaited: a scan is a model call per message, and a phone
    // holding a request open for minutes has nothing to show for the wait.
    // The GET poll above is how the answer arrives.
    // Both buttons look back a day. The scheduled task keeps the watermark,
    // which is right for a job running every fifteen minutes; a person
    // pressing Scan now is asking for anything missed, and the watermark has
    // usually already passed whatever prompted them to press it.
    return json(startLiveScan({ hours: 24, ...(inspect ? { inspect: true } : {}) }));
  } catch (error) {
    return handle(error);
  }
}
