/**
 * How this device can turn speech into text.
 *
 * The Web Speech API is not trustworthy on iOS. `webkitSpeechRecognition`
 * exists there — so feature detection passes — but inside an installed PWA it
 * silently produces nothing, and the recogniser never ends, which leaves the
 * button stuck mid-dictation with no error to show. Detection cannot tell
 * "present" from "works".
 *
 * iOS does have first-rate dictation: the microphone key on its own keyboard.
 * It runs on-device, costs nothing, handles Australian place names better than
 * anything we could reach over the network, and works in a standalone PWA. So
 * on iOS the big button opens the keyboard rather than pretending to listen.
 */
export type Dictation =
  /** Web Speech API — works, and streams words as you say them. */
  | "web-speech"
  /** iOS: focus the text field and let the keyboard's mic key do the work. */
  | "keyboard"
  /** Record audio and post it for transcription. Needs a configured service. */
  | "record"
  /** Nothing available; typing only. */
  | "none";

export interface DeviceHints {
  userAgent: string;
  platform: string;
  maxTouchPoints: number;
  hasRecognition: boolean;
  hasRecorder: boolean;
  /** Whether the server has a transcription service configured. */
  transcribeConfigured: boolean;
}

export function isApplePhoneOrTablet(hints: DeviceHints): boolean {
  if (/iPhone|iPad|iPod/i.test(hints.userAgent)) return true;
  // iPadOS 13+ reports itself as a Mac; touch points are what give it away.
  return /Mac/i.test(hints.platform) && hints.maxTouchPoints > 1;
}

export function dictationSupport(hints: DeviceHints): Dictation {
  if (isApplePhoneOrTablet(hints)) return "keyboard";
  if (hints.hasRecognition) return "web-speech";
  if (hints.hasRecorder && hints.transcribeConfigured) return "record";
  return "none";
}

export function readHints(transcribeConfigured: boolean): DeviceHints {
  const nav = typeof navigator === "undefined" ? null : navigator;
  return {
    userAgent: nav?.userAgent ?? "",
    platform: (nav as any)?.platform ?? "",
    maxTouchPoints: nav?.maxTouchPoints ?? 0,
    hasRecognition:
      typeof window !== "undefined" &&
      Boolean((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition),
    hasRecorder: typeof window !== "undefined" && Boolean(window.MediaRecorder),
    transcribeConfigured,
  };
}

/** True when running from the home screen rather than a browser tab. */
export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    (window.navigator as any).standalone === true ||
    window.matchMedia?.("(display-mode: standalone)").matches === true
  );
}
