import { readDeployState, startDeploy } from "@/lib/deploy";
import { readPowerState } from "@/lib/power";
import { handle, json } from "@/lib/http";

export const dynamic = "force-dynamic";

/**
 * What is running here, and a way to ask for what is newer.
 *
 * Behind the household passcode like everything else — the middleware only
 * opens `/api/cron/`, `/api/auth/` and the unlock screen — and it takes no
 * command from the caller, only "go".
 */
export async function GET() {
  try {
    // Power sits alongside the build because they answer the same question:
    // is this machine configured the way we think it is. The wall slept for a
    // fortnight with nothing on any screen to say why.
    const [deploy, power] = await Promise.all([readDeployState(), readPowerState()]);
    return json({ ...deploy, power });
  } catch (error) {
    return handle(error);
  }
}

export async function POST() {
  try {
    const result = await startDeploy();
    // Not an error response when it fails: the reason is a sentence for a
    // person standing in a kitchen, and the screen shows it either way.
    return json(result);
  } catch (error) {
    return handle(error);
  }
}
