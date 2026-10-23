import { fail, handle, json } from "@/lib/http";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Fallback speech-to-text.
 *
 * The capture screen transcribes on-device with the Web Speech API, which
 * Safari on iOS supports and which costs nothing. This endpoint exists for
 * the browsers that don't, and only does anything when an OpenAI-compatible
 * transcription endpoint is configured — Claude has no audio input, so there
 * is nothing honest to fall back to otherwise.
 */
export async function POST(request: Request) {
  try {
    const key = process.env.TRANSCRIBE_API_KEY;
    const url =
      process.env.TRANSCRIBE_URL || "https://api.openai.com/v1/audio/transcriptions";
    const model = process.env.TRANSCRIBE_MODEL || "whisper-1";

    if (!key) {
      return fail(
        "This browser can't transcribe on its own and no transcription " +
          "service is configured. Type it instead.",
        503,
      );
    }

    const incoming = await request.formData();
    const audio = incoming.get("audio");
    if (!audio || typeof audio === "string") return fail("No audio", 400);

    const outgoing = new FormData();
    outgoing.set("file", audio, "capture.webm");
    outgoing.set("model", model);

    const response = await fetch(url, {
      method: "POST",
      headers: { authorization: `Bearer ${key}` },
      body: outgoing,
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      return fail(body?.error?.message || `Transcription failed (${response.status})`, 502);
    }

    return json({ text: String(body?.text ?? "").trim() });
  } catch (error) {
    return handle(error);
  }
}
