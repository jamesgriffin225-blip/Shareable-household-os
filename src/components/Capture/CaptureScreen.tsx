"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import ProfileGate from "@/components/ProfileGate";
import { api } from "@/lib/client/api";
import { prepare } from "@/lib/client/images";
import { initials, useProfile } from "@/lib/client/profile";
import type { HouseholdState } from "@/lib/types";
import { useSpeech } from "./useSpeech";

interface Outcome {
  executed: boolean;
  action: string;
  summary: string;
  activityId?: number;
  approvalId?: string;
  error?: string;
}

interface CaptureResponse {
  reply: string;
  outcomes: Outcome[];
  executed: number;
  queued: number;
}

const MAX_EDGE = 1600;

/** Phones take 12 megapixel photos of A4 flyers. Send something sensible. */
async function shrink(file: File): Promise<Blob> {
  if (!("createImageBitmap" in window)) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    if (scale === 1 && file.size < 1_500_000) return file;

    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const context = canvas.getContext("2d");
    if (!context) return file;
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.85),
    );
    return blob ?? file;
  } catch {
    return file;
  }
}

export default function CaptureScreen() {
  const {
    profiles,
    profile,
    profileId,
    choose,
    clear,
    ready,
    error: profileError,
  } = useProfile();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<CaptureResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [typed, setTyped] = useState("");
  const [pending, setPending] = useState(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const frameInput = useRef<HTMLInputElement>(null);
  const typedInput = useRef<HTMLInputElement>(null);
  const [transcribeConfigured, setTranscribeConfigured] = useState(false);
  const speech = useSpeech(transcribeConfigured);

  /**
   * On iOS the big button opens the keyboard instead of listening.
   *
   * webkitSpeechRecognition exists there but does nothing inside an installed
   * PWA — no results, and the recogniser never ends. Apple's own keyboard
   * dictation works perfectly, runs on-device and costs nothing, so that is
   * where the button sends you.
   */
  const keyboardMode = speech.support === "keyboard";

  const loadPending = useCallback(async () => {
    try {
      const state = await api<HouseholdState>("/api/state");
      setPending(state.approvals.length);
    } catch {
      /* the badge is not worth an error message */
    }
  }, []);

  useEffect(() => {
    void loadPending();
    const timer = setInterval(loadPending, 30_000);
    return () => clearInterval(timer);
  }, [loadPending]);

  useEffect(() => {
    api<{ configured?: Record<string, boolean> }>("/api/settings")
      .then((data) => setTranscribeConfigured(Boolean(data.configured?.transcribe)))
      .catch(() => setTranscribeConfigured(false));
  }, []);

  const send = useCallback(
    async (payload: { text?: string; image?: Blob; kind: "voice" | "text" | "photo" }) => {
      if (!profileId) return;
      setBusy(true);
      setError(null);
      setResult(null);
      try {
        let response: CaptureResponse;
        if (payload.image) {
          const form = new FormData();
          form.set("profileId", profileId);
          form.set("kind", "photo");
          if (payload.text) form.set("text", payload.text);
          form.set("image", payload.image, "capture.jpg");
          response = await api<CaptureResponse>("/api/capture", {
            method: "POST",
            body: form,
            profileId,
          });
        } else {
          response = await api<CaptureResponse>("/api/capture", {
            method: "POST",
            body: JSON.stringify({ text: payload.text, kind: payload.kind }),
            profileId,
          });
        }
        setResult(response);
        speech.reset();
        setTyped("");
        void loadPending();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setBusy(false);
      }
    },
    [loadPending, profileId, speech],
  );

  const toggleMic = useCallback(async () => {
    if (speech.listening) {
      speech.stop();
      // Give the recogniser a moment to emit its last final result, then read
      // the refs rather than the rendered state.
      setTimeout(() => {
        const text = speech.latest();
        if (text) void send({ text, kind: "voice" });
      }, 350);
      return;
    }
    setResult(null);
    setError(null);
    await speech.start();
  }, [send, speech]);

  const onPhoto = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = "";
      if (!file) return;
      const spoken = speech.latest();
      speech.stop();
      void send({ image: await shrink(file), text: spoken || undefined, kind: "photo" });
    },
    [send, speech],
  );

  /**
   * Photos for the wall, not for the parser.
   *
   * Deliberately a separate control: sending a school flyer and sending a
   * picture of the baby are different intentions, and asking the model to work
   * out which is which would get it wrong at exactly the wrong moment.
   */
  const onFramePhotos = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(event.target.files ?? []);
      event.target.value = "";
      if (files.length === 0 || !profileId) return;

      setBusy(true);
      setError(null);
      setResult(null);
      let added = 0;
      try {
        for (const file of files) {
          const prepared = await prepare(file);
          const form = new FormData();
          form.set("profileId", profileId);
          form.set("image", prepared.full, "photo.jpg");
          form.set("thumb", prepared.thumb, "thumb.jpg");
          form.set("width", String(prepared.width));
          form.set("height", String(prepared.height));
          await api("/api/photos", { method: "POST", body: form, profileId });
          added += 1;
        }
        setResult({
          reply: "",
          executed: added,
          queued: 0,
          outcomes: [
            {
              executed: true,
              action: "add_photo",
              summary: `${added} photo${added === 1 ? "" : "s"} → the frame`,
            },
          ],
        });
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setBusy(false);
      }
    },
    [profileId],
  );

  const undo = useCallback(
    async (activityId: number) => {
      try {
        await api("/api/undo", {
          method: "POST",
          body: JSON.stringify({ activityId }),
          profileId,
        });
        setResult((current) =>
          current
            ? {
                ...current,
                outcomes: current.outcomes.map((outcome) =>
                  outcome.activityId === activityId
                    ? { ...outcome, executed: false, summary: `Undone — ${outcome.summary}` }
                    : outcome,
                ),
              }
            : current,
        );
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    },
    [profileId],
  );

  if (!ready) {
    return (
      <main className="capture">
        <div />
        <div className="capture__stage">
          <span className="spinner" />
        </div>
        <div />
      </main>
    );
  }

  if (!profile) {
    return (
      <ProfileGate
        profiles={profiles}
        onChoose={choose}
        error={profileError}
        note="Everything you add gets your name on it. Pick once per phone."
      />
    );
  }

  const live = `${speech.transcript} ${speech.interim}`.trim();
  const undoable = result?.outcomes.filter((outcome) => outcome.activityId) ?? [];

  return (
    <main className="capture">
      <header className="capture__top">
        <button className="capture__who" onClick={clear}>
          <span className="avatar avatar--sm" style={{ background: profile.color }}>
            {initials(profile.name)}
          </span>
          {profile.name}
        </button>
        {/*
          * The other half of the phone app. Capture is the front door because
          * the mic is what makes this get used at all — but "what's on?" is
          * the other thing you ask a phone, and it should never be more than
          * one tap away.
          */}
        <Link className="capture__badge" href="/today">
          {pending > 0 ? (
            <>
              <span className="dot" style={{ background: "var(--gold)" }} />
              {pending} needs your OK
            </>
          ) : (
            "Today"
          )}
        </Link>
      </header>

      <div className="capture__stage">
        <p className={`capture__heard${live ? "" : " capture__heard--idle"}`}>
          {live ? (
            <>
              {speech.transcript} <em>{speech.interim}</em>
            </>
          ) : speech.listening ? (
            "Listening…"
          ) : (
            keyboardMode
              ? "Say it or type it. “We’re out of nappies and Tom has swimming Thursday at four.”"
              : "Tap and say it. “We’re out of nappies and Tom has swimming Thursday at four.”"
          )}
        </p>

        <button
          className={`mic${speech.listening ? " mic--live" : ""}`}
          onClick={keyboardMode ? () => typedInput.current?.focus() : toggleMic}
          disabled={busy || speech.support === "none"}
          aria-label={
            keyboardMode
              ? "Open the keyboard to dictate"
              : speech.listening
                ? "Stop and send"
                : "Start dictating"
          }
        >
          <MicGlyph listening={speech.listening} />
          <span className="mic__label">{speech.listening ? "Send" : "Speak"}</span>
        </button>

        {keyboardMode ? (
          <p className="capture__hint">
            Tap <strong>Speak</strong>, then the <strong>🎤</strong> on your
            keyboard. Apple&rsquo;s dictation is better than anything a web page
            can do, and it works offline.
          </p>
        ) : null}

        <div className="capture__actions">
          <button
            className="btn btn--photo"
            onClick={() => fileInput.current?.click()}
            disabled={busy}
          >
            <CameraGlyph />
            Photograph something
          </button>
          <input
            ref={fileInput}
            type="file"
            accept="image/*"
            capture="environment"
            onChange={onPhoto}
            className="sr-only"
            aria-label="Take or choose a photo"
          />
          <button
            className="btn btn--quiet"
            onClick={() => frameInput.current?.click()}
            disabled={busy}
          >
            Send photos to the frame
          </button>
          <input
            ref={frameInput}
            type="file"
            accept="image/*"
            multiple
            onChange={onFramePhotos}
            className="sr-only"
            aria-label="Choose photos for the frame"
          />
          <form
            className="capture__type"
            onSubmit={(event) => {
              event.preventDefault();
              const text = typed.trim();
              if (text) void send({ text, kind: "text" });
            }}
          >
            <input
              className="field"
              ref={typedInput}
              placeholder={keyboardMode ? "Say it or type it…" : "…or type it"}
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              disabled={busy}
            />
            <button className="btn btn--primary" disabled={busy || !typed.trim()}>
              Send
            </button>
          </form>
        </div>
      </div>

      <footer>
        {speech.error ? <div className="banner">{speech.error}</div> : null}
        {busy ? (
          <div className="toast toast--working">
            <span className="spinner" /> Working out what that was…
          </div>
        ) : null}
        {error ? (
          <div className="toast toast--error">
            <div className="toast__lines">
              <div className="toast__line">
                <span className="toast__mark toast__mark--error">!</span>
                {error}
              </div>
            </div>
          </div>
        ) : null}
        {result ? (
          <div className="toast">
            <div className="toast__lines">
              {result.outcomes.length === 0 ? (
                <div className="toast__line">
                  <span className="toast__mark">–</span>
                  {result.reply || "Nothing to record in that."}
                </div>
              ) : (
                result.outcomes.map((outcome, index) => (
                  <div className="toast__line" key={`${outcome.action}-${index}`}>
                    <span
                      className={`toast__mark${
                        outcome.executed
                          ? ""
                          : outcome.error
                            ? " toast__mark--error"
                            : " toast__mark--queued"
                      }`}
                    >
                      {outcome.executed ? "✓" : outcome.error ? "!" : "?"}
                    </span>
                    <span>
                      {outcome.summary}
                      {!outcome.executed && outcome.approvalId ? (
                        <span className="item__from"> — parked for a look</span>
                      ) : null}
                      {outcome.error ? (
                        <span className="item__from"> — {outcome.error}</span>
                      ) : null}
                    </span>
                  </div>
                ))
              )}
            </div>
            {undoable.length > 0 ? (
              <div className="toast__row">
                {undoable.map((outcome) => (
                  <button
                    key={outcome.activityId}
                    className="btn btn--ghost"
                    onClick={() => void undo(outcome.activityId!)}
                  >
                    Undo {shortLabel(outcome.summary)}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </footer>
    </main>
  );
}

function shortLabel(summary: string): string {
  const colon = summary.indexOf(":");
  const label = colon === -1 ? summary : summary.slice(0, colon);
  return label.toLowerCase();
}

function CameraGlyph() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 8.5A1.5 1.5 0 0 1 4.5 7h2.2l1.2-2h8.2l1.2 2h2.2A1.5 1.5 0 0 1 21 8.5v9A1.5 1.5 0 0 1 19.5 19h-15A1.5 1.5 0 0 1 3 17.5z" />
      <circle cx="12" cy="13" r="3.4" />
    </svg>
  );
}

function MicGlyph({ listening }: { listening: boolean }) {
  return (
    <svg
      width="64"
      height="64"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      aria-hidden="true"
      style={{ marginBottom: "12%" }}
    >
      {listening ? (
        <rect x="7" y="7" width="10" height="10" rx="2" fill="currentColor" stroke="none" />
      ) : (
        <>
          <rect x="9" y="3" width="6" height="11" rx="3" fill="currentColor" stroke="none" />
          <path d="M5.5 11.5a6.5 6.5 0 0 0 13 0" />
          <path d="M12 18v3" />
        </>
      )}
    </svg>
  );
}
