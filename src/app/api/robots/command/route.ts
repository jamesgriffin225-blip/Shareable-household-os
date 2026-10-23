import { logActivity } from "@/lib/actions";
import {
  describeRobotCommand,
  sendRobot,
  validRobotId,
  type RobotCommand,
} from "@/lib/robots";
import { fail, handle, json, readJson, requireProfile } from "@/lib/http";

export const dynamic = "force-dynamic";
export const maxDuration = 20;

const COMMANDS: RobotCommand[] = ["start", "pause", "dock"];

export async function POST(request: Request) {
  try {
    const body = await readJson<{
      entityId?: string;
      command?: RobotCommand;
      name?: string;
      profileId?: string;
    }>(request);
    const profileId = await requireProfile(request, body);

    if (!body.entityId || !validRobotId(body.entityId)) return fail("Which robot?", 400);
    if (!body.command || !COMMANDS.includes(body.command)) {
      return fail("Which command?", 400);
    }

    await sendRobot(body.entityId, body.command);

    // Worth a name against it: "who set the mower going at 6am" is a question
    // that gets asked.
    await logActivity({
      action: "send_robot",
      summary: describeRobotCommand(body.name || "the robot", body.command),
      profileId,
      source: "manual",
      entityType: "robot",
      entityId: body.entityId,
    });

    return json({ ok: true });
  } catch (error) {
    return handle(error);
  }
}
