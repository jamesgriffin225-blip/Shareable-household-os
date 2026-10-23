"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSpeech } from "@/components/Capture/useSpeech";
import { api } from "@/lib/client/api";

interface Outcome {
  executed: boolean;
  action: string;
  summary: string;
  error?: string;
}

interface CaptureResponse {
  reply: string;
  outcomes: Outcome[];
  executed: number;
  queued: number;
}

interface AskResponse {
  answer: string;
  missing: string[];
}

/**
 * Adding and asking are separate, chosen by the person.
 *
 * Not inferred from the wording. "Do we need milk" and "we need milk" are one
 * character apart and mean opposite things, and getting that wrong either
 * silently adds a shopping item nobody asked for or answers a question instead
 * of doing what was said. A two-button choice is worth more than the guess.
 */
type Mode = "add" | "ask";

/**
 * Capture, from the wall.
 *
 * The phone version is the front door of this whole app; standing in the
 * kitchen and having to find your phone to add milk to the list is exactly the
 * friction it was built to remove. Same endpoint, same parsing, same approval
 * rules — only the surface is different.
 *
 * No camera button here. The Surface's camera faces the wall it is mounted on.
 */
export default function QuickCapture({
  profileId,
  onClose,
  onChanged,
}: {
  profileId: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [mode, setMode] = useState<Mode>("add");
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CaptureResponse | null>(null);
  const [answer, setAnswer] = useState<AskResponse | null>(null);
  const field = useRef<HTMLInputElement>(null);
  const speech = useSpeech(false);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    field.current?.focus();
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const send = useCallback(
    async (text: string, kind: "voice" | "text") => {
      const trimmed = text.trim();
      if (!trimmed) return;
      setBusy(true);
      setError(null);
      try {
        if (mode === "ask") {
          const response = await api<AskResponse>("/api/ask", {
            method: "POST",
            body: JSON.stringify({ question: trimmed }),
            profileId,
          });
          setAnswer(response);
          setTyped("");
          speech.reset();
          return;
        }
        const response = await api<CaptureResponse>("/api/capture", {
          method: "POST",
          body: JSON.stringify({ text: trimmed, kind }),
          profileId,
        });
        setResult(response);
        setTyped("");
        speech.reset();
        onChanged();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setBusy(false);
      }
    },
    [mode, onChanged, profileId, speech],
  );

  const switchTo = useCallback((next: Mode) => {
    setMode(next);
    setResult(null);
    setAnswer(null);
    setError(null);
  }, []);

  const toggleMic = useCallback(() => {
    if (speech.listening) {
      // Read from refs, not from rendered state: stopping and then reading the
      // transcript loses whatever was finalised in between, which is routinely
      // the last few words.
      const heard = speech.latest();
      speech.stop();
      void send(heard, "voice");
    } else {
      void speech.start();
    }
  }, [send, speech]);

  const live = `${speech.transcript} ${speech.interim}`.trim();
  const canTalk = speech.support === "web-speech";

  return (
    <div className="sheet" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="sheet__card quick" onClick={(click) => click.stopPropagation()}>
        <header className="sheet__head">
          <span />
          <div>
            <h2 className="sheet__title">
              {mode === "add" ? "Add something" : "Ask something"}
            </h2>
            <p className="sheet__when">
              {mode === "add"
                ? "Say it or type it. It goes wherever it belongs."
                : "About the calendar, the list or the jobs. It only reads."}
            </p>
          </div>
          <button className="sheet__close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>

        <div className="tabs" role="tablist">
          <button
            className="tab"
            role="tab"
            aria-selected={mode === "add"}
            onClick={() => switchTo("add")}
          >
            Add
          </button>
          <button
            className="tab"
            role="tab"
            aria-selected={mode === "ask"}
            onClick={() => switchTo("ask")}
          >
            Ask
          </button>
        </div>

        {canTalk ? (
          <button
            className={`quick__mic${speech.listening ? " quick__mic--on" : ""}`}
            onClick={toggleMic}
            disabled={busy}
          >
            <svg viewBox="0 0 24 24" width="26" height="26" fill="none"
                 stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"
                 strokeLinejoin="round" aria-hidden="true">
              <rect x="9" y="3" width="6" height="11" rx="3" />
              <path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3" />
            </svg>
            {speech.listening ? "Listening — tap to send" : "Speak"}
          </button>
        ) : null}

        {live ? (
          <p className="quick__heard">
            {speech.transcript} <em>{speech.interim}</em>
          </p>
        ) : null}

        <form
          className="adder"
          onSubmit={(event) => {
            event.preventDefault();
            void send(typed, "text");
          }}
        >
          <input
            ref={field}
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            placeholder={
              mode === "add"
                ? "We're out of nappies and Tom has swimming Thursday at four"
                : "When do we next have a free Saturday afternoon?"
            }
            aria-label={mode === "add" ? "What happened?" : "What do you want to know?"}
            disabled={busy}
          />
          <button className="btn btn--primary" disabled={busy || !typed.trim()}>
            {busy ? "…" : "Send"}
          </button>
        </form>

        {speech.error ? <div className="banner">{speech.error}</div> : null}
        {error ? <div className="banner">{error}</div> : null}

        {answer ? (
          <div className="quick__result">
            <p className="quick__answer">{answer.answer}</p>
            {answer.missing.length > 0 ? (
              <p className="money__asat">
                Could not read: {answer.missing.join(", ")}.
              </p>
            ) : null}
          </div>
        ) : null}

        {result ? (
          <div className="quick__result">
            <p className="quick__reply">{result.reply}</p>
            {result.outcomes.map((outcome, index) => (
              <div className="budget__row" key={`${outcome.action}-${index}`}>
                <span>{outcome.summary}</span>
                <span style={{ color: outcome.executed ? "var(--sage)" : "var(--gold)" }}>
                  {outcome.executed ? "done" : outcome.error ? "failed" : "needs your OK"}
                </span>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
