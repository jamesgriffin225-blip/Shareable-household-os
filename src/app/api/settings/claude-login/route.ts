import { claudeLoginState, startClaudeLogin } from "@/lib/claude-login";
import { backendName } from "@/lib/llm";
import { fail, handle, json } from "@/lib/http";

export const dynamic = "force-dynamic";

/**
 * Renew the Claude Code sign-in on the wall.
 *
 * Behind the household passcode, and it takes no command from the caller --
 * only "go", exactly as the update button does. The thing it starts is one
 * fixed subprocess with fixed arguments.
 */
export async function GET() {
  try {
    return json(claudeLoginState());
  } catch (error) {
    return handle(error);
  }
}

export async function POST() {
  try {
    if (backendName() !== "cli") {
      return fail("This deployment uses the API backend, which has no sign-in to renew.", 400);
    }
    return json(await startClaudeLogin());
  } catch (error) {
    return handle(error);
  }
}
