import assert from "node:assert/strict";
import { test } from "node:test";
import {
  dictationSupport,
  isApplePhoneOrTablet,
  type DeviceHints,
} from "../src/components/Capture/dictation.ts";

const base: DeviceHints = {
  userAgent: "",
  platform: "",
  maxTouchPoints: 0,
  hasRecognition: false,
  hasRecorder: false,
  transcribeConfigured: false,
};

const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 " +
  "(KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1";

test("iOS never uses the Web Speech API, even though it claims to have it", () => {
  // This is the whole point: webkitSpeechRecognition is present on iOS and
  // does nothing in an installed PWA, so detection must not believe it.
  const iphone = {
    ...base,
    userAgent: IPHONE,
    platform: "iPhone",
    hasRecognition: true,
    hasRecorder: true,
  };
  assert.equal(dictationSupport(iphone), "keyboard");
});

test("an iPad pretending to be a Mac is still an iPad", () => {
  const ipad = {
    ...base,
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1.15",
    platform: "MacIntel",
    maxTouchPoints: 5,
    hasRecognition: true,
  };
  assert.equal(isApplePhoneOrTablet(ipad), true);
  assert.equal(dictationSupport(ipad), "keyboard");

  const realMac = { ...ipad, maxTouchPoints: 0 };
  assert.equal(isApplePhoneOrTablet(realMac), false);
  assert.equal(dictationSupport(realMac), "web-speech");
});

test("desktop browsers with the API get live dictation", () => {
  const surface = {
    ...base,
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/140 Edg/140",
    platform: "Win32",
    hasRecognition: true,
    hasRecorder: true,
  };
  assert.equal(dictationSupport(surface), "web-speech");
});

test("recording is only offered when something can actually transcribe it", () => {
  // Otherwise the person records a sentence and gets a 503 for their trouble.
  const noService = { ...base, platform: "Linux", hasRecorder: true };
  assert.equal(dictationSupport(noService), "none");

  const withService = { ...noService, transcribeConfigured: true };
  assert.equal(dictationSupport(withService), "record");
});
