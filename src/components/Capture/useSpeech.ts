"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { dictationSupport, readHints, type Dictation } from "./dictation.ts";

type Recognition = any;

function recognitionCtor(): Recognition | null {
  if (typeof window === "undefined") return null;
  return (
    (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition || null
  );
}

/** A recogniser that never starts is broken, and says so rather than hanging. */
const START_TIMEOUT_MS = 3000;
/** Desktop recognisers stop on silence; restarting is normal, forever is not. */
const MAX_RESTARTS = 30;

export function useSpeech(transcribeConfigured = false) {
  const [listening, setListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [interim, setInterim] = useState("");
  const [error, setError] = useState<string | null>(null);

  // What this device can do is a property of the device, not of state, and is
  // unknowable on the server — so it is read through the external-store hook
  // rather than guessed during render.
  const support = useSyncExternalStore<Dictation>(
    () => () => undefined,
    () => dictationSupport(readHints(transcribeConfigured)),
    () => "none",
  );

  const recognition = useRef<Recognition>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const wanted = useRef(false);
  const started = useRef(false);
  const restarts = useRef(0);
  const watchdog = useRef<ReturnType<typeof setTimeout> | null>(null);
  const finalText = useRef("");
  const liveText = useRef("");

  const clearWatchdog = () => {
    if (watchdog.current) clearTimeout(watchdog.current);
    watchdog.current = null;
  };

  const reset = useCallback(() => {
    finalText.current = "";
    liveText.current = "";
    setTranscript("");
    setInterim("");
    setError(null);
  }, []);

  /**
   * Stopping must always work.
   *
   * The UI state is set first and unconditionally, because a recogniser that
   * has wedged will not fire `onend`, and a button that will not turn off is
   * worse than one that never turned on.
   */
  const stop = useCallback(() => {
    wanted.current = false;
    started.current = false;
    restarts.current = 0;
    clearWatchdog();
    setListening(false);
    try {
      recognition.current?.abort?.();
    } catch {
      /* nothing to abort */
    }
    try {
      recognition.current?.stop?.();
    } catch {
      /* already stopped */
    }
    recognition.current = null;
    if (recorder.current && recorder.current.state !== "inactive") {
      recorder.current.stop();
    }
  }, []);

  const startWebSpeech = useCallback(() => {
    const Ctor = recognitionCtor();
    if (!Ctor) return;

    const instance = new Ctor();
    instance.continuous = true;
    instance.interimResults = true;
    instance.lang = navigator.language || "en-AU";

    instance.onstart = () => {
      started.current = true;
      clearWatchdog();
    };

    instance.onresult = (event: any) => {
      started.current = true;
      clearWatchdog();
      let live = "";
      for (let index = event.resultIndex; index < event.results.length; index++) {
        const result = event.results[index];
        const text = result[0]?.transcript ?? "";
        if (result.isFinal) finalText.current = `${finalText.current} ${text}`.trim();
        else live += text;
      }
      liveText.current = live.trim();
      setTranscript(finalText.current);
      setInterim(liveText.current);
    };

    instance.onerror = (event: any) => {
      if (event.error === "no-speech" || event.error === "aborted") return;
      setError(
        event.error === "not-allowed"
          ? "Microphone permission was refused."
          : `Dictation stopped: ${event.error}. Type it instead.`,
      );
      wanted.current = false;
      clearWatchdog();
      setListening(false);
    };

    // Recognisers end on silence. Restarting keeps a pause from ending the
    // sentence — but only while something is actually working, and not forever.
    instance.onend = () => {
      if (!wanted.current || !started.current || restarts.current >= MAX_RESTARTS) {
        clearWatchdog();
        setListening(false);
        return;
      }
      restarts.current += 1;
      try {
        instance.start();
      } catch {
        setListening(false);
      }
    };

    recognition.current = instance;
    instance.start();

    // If `onstart` never arrives, the API is present but dead — which is
    // exactly what iOS does inside an installed PWA.
    watchdog.current = setTimeout(() => {
      if (started.current) return;
      setError("Dictation didn't start on this browser. Type it instead.");
      stop();
    }, START_TIMEOUT_MS);
  }, [stop]);

  const startRecording = useCallback(async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    chunks.current = [];
    const instance = new MediaRecorder(stream);
    instance.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.current.push(event.data);
    };
    instance.onstop = async () => {
      stream.getTracks().forEach((track) => track.stop());
      const blob = new Blob(chunks.current, { type: instance.mimeType || "audio/webm" });
      if (blob.size === 0) return;
      try {
        const form = new FormData();
        form.set("audio", blob, "capture.webm");
        const response = await fetch("/api/transcribe", { method: "POST", body: form });
        const body = await response.json().catch(() => null);
        if (!response.ok) throw new Error(body?.error || "Transcription failed");
        finalText.current = String(body.text || "");
        setTranscript(finalText.current);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    };
    recorder.current = instance;
    instance.start();
  }, []);

  const start = useCallback(async () => {
    reset();
    wanted.current = true;
    started.current = false;
    restarts.current = 0;
    setListening(true);
    try {
      if (support === "web-speech") startWebSpeech();
      else if (support === "record") await startRecording();
      else {
        // "keyboard" is handled by the screen, which focuses the text field.
        setListening(false);
        wanted.current = false;
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setListening(false);
      wanted.current = false;
    }
  }, [reset, startRecording, startWebSpeech, support]);

  useEffect(() => () => stop(), [stop]);

  return {
    listening,
    transcript,
    interim,
    error,
    support,
    start,
    stop,
    reset,
    /**
     * The text as of right now, from refs rather than state.
     *
     * Stopping dictation and reading the rendered transcript loses whatever the
     * recogniser finalises in the moment between — routinely the last two or
     * three words of a sentence.
     */
    latest: () => `${finalText.current} ${liveText.current}`.trim(),
    setTranscript: (value: string) => {
      finalText.current = value;
      liveText.current = "";
      setTranscript(value);
    },
  };
}
