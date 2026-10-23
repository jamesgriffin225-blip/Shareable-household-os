import {
  EMAIL_MODEL_CHOICES,
  defaultEmailModel,
  emailModelChoice,
  setEmailModelChoice,
} from "@/lib/model-choice";
import { fail, handle, json } from "@/lib/http";

export const dynamic = "force-dynamic";

/**
 * Which model reads the household's email.
 *
 * A setting rather than an environment variable, because the machine it
 * governs has no keyboard and `.env.local` can only be edited by typing on
 * it. The value is checked against the list this screen offers rather than
 * taken as given: it is handed to a subprocess, and an endpoint that will
 * pass any string to a command line is not a settings endpoint.
 */
export async function GET() {
  try {
    return json({
      chosen: await emailModelChoice(),
      fallback: defaultEmailModel(),
      choices: EMAIL_MODEL_CHOICES,
    });
  } catch (error) {
    return handle(error);
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as { model?: unknown } | null;
    const wanted = typeof body?.model === "string" ? body.model.trim() : "";

    const allowed = EMAIL_MODEL_CHOICES.map((choice) => choice.value as string);
    if (!allowed.includes(wanted)) {
      return fail(`"${wanted}" is not one of the models this screen offers`, 400);
    }

    await setEmailModelChoice(wanted || null);
    return json({ chosen: wanted || null, fallback: defaultEmailModel() });
  } catch (error) {
    return handle(error);
  }
}
