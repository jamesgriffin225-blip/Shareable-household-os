import assert from "node:assert/strict";
import { test } from "node:test";
import {
  readStates,
  validCameraId,
  validPanelId,
} from "../src/lib/cameras.ts";

const states = [
  {
    entity_id: "camera.front_door",
    state: "idle",
    attributes: { friendly_name: "Front Door", battery_level: 82 },
    last_updated: "2026-09-05T01:00:00+00:00",
  },
  {
    entity_id: "camera.back_yard",
    state: "unavailable",
    attributes: { friendly_name: "Back Yard" },
    last_updated: "2026-09-05T00:00:00+00:00",
  },
  {
    entity_id: "binary_sensor.front_door_motion_detected",
    state: "on",
    attributes: { device_class: "motion" },
    last_changed: "2026-09-05T01:04:00+00:00",
  },
  {
    entity_id: "binary_sensor.back_yard_motion_detected",
    state: "off",
    attributes: { device_class: "motion" },
    last_changed: "2026-09-04T22:10:00+00:00",
  },
  {
    entity_id: "sensor.back_yard_battery",
    state: "44",
    attributes: { device_class: "battery" },
  },
  {
    entity_id: "sensor.back_yard_temperature",
    state: "17.5",
    attributes: { device_class: "temperature" },
  },
  {
    entity_id: "alarm_control_panel.blink_home",
    state: "armed_away",
    attributes: { friendly_name: "Blink Home" },
  },
  // Everything else in the house, which must not turn up as a camera.
  { entity_id: "light.kitchen", state: "on", attributes: {} },
  { entity_id: "sensor.washing_machine_battery", state: "9", attributes: { device_class: "battery" } },
];

test("cameras come back with their own motion, battery and temperature", () => {
  const { cameras } = readStates(states as never);
  assert.deepEqual(
    cameras.map((camera) => camera.entityId),
    ["camera.front_door", "camera.back_yard"],
  );

  const front = cameras[0];
  assert.equal(front.name, "Front Door");
  assert.equal(front.available, true);
  assert.equal(front.motionNow, true);
  assert.equal(front.motionAt, "2026-09-05T01:04:00+00:00");
  // Battery from the camera's own attribute when it has one.
  assert.equal(front.battery, 82);

  const back = cameras[1];
  assert.equal(back.available, false, "unavailable cameras are marked, not hidden");
  assert.equal(back.motionNow, false);
  // Battery from the paired sensor when the camera reports none.
  assert.equal(back.battery, 44);
  assert.equal(back.temperature, 17.5);
});

test("a sensor belonging to something else is not borrowed", () => {
  const { cameras } = readStates(states as never);
  // sensor.washing_machine_battery must not attach to either camera.
  assert.notEqual(cameras[0].battery, 9);
  assert.notEqual(cameras[1].battery, 9);
});

test("the alarm panel's armed state is read from its own state string", () => {
  const { panels } = readStates(states as never);
  assert.equal(panels.length, 1);
  assert.equal(panels[0].armed, true);

  const disarmed = readStates([
    { entity_id: "alarm_control_panel.blink_home", state: "disarmed", attributes: {} },
  ] as never);
  assert.equal(disarmed.panels[0].armed, false);

  const arming = readStates([
    { entity_id: "alarm_control_panel.blink_home", state: "arming", attributes: {} },
  ] as never);
  assert.equal(arming.panels[0].armed, false, "arming is not yet armed");
});

test("HOME_ASSISTANT_CAMERAS narrows the wall to the cameras you meant", () => {
  process.env.HOME_ASSISTANT_CAMERAS = "camera.front_door";
  try {
    const { cameras } = readStates(states as never);
    assert.deepEqual(
      cameras.map((camera) => camera.entityId),
      ["camera.front_door"],
    );
  } finally {
    delete process.env.HOME_ASSISTANT_CAMERAS;
  }
});

test("entity ids reaching a URL are strictly validated", () => {
  // This proxy runs on the public internet and makes requests into a house.
  assert.equal(validCameraId("camera.front_door"), true);
  assert.equal(validCameraId("camera.Front_Door"), false);
  assert.equal(validCameraId("camera.front_door/../../config"), false);
  assert.equal(validCameraId("../api/config"), false);
  assert.equal(validCameraId("light.kitchen"), false);
  assert.equal(validCameraId("http://evil.example/x"), false);
  assert.equal(validCameraId("camera."), false);
  assert.equal(validCameraId(""), false);

  assert.equal(validPanelId("alarm_control_panel.blink_home"), true);
  assert.equal(validPanelId("camera.front_door"), false);
  assert.equal(validPanelId("alarm_control_panel.a/../b"), false);
});

// ---------------------------------------------------------------- Blink shapes
//
// Taken from a real Home Assistant with five Blink cameras on it. The entity
// ids and the sensor names disagree — `camera.backyard` against
// `sensor.blink_backyard_temperature` — which is exactly the case the old
// stem-only matching got wrong.

const BLINK_CAMERA = {
  entity_id: "camera.backyard",
  state: "idle",
  last_updated: "2026-09-11T02:00:00Z",
  attributes: {
    friendly_name: "Backyard",
    brand: "Blink",
    temperature: 80,
    temperature_c: 26.7,
    battery: "ok",
    battery_level: null,
    battery_voltage: 158,
    motion_detected: false,
    wifi_strength: -68,
  },
};

const BLINK_TEMP_SENSOR = {
  entity_id: "sensor.blink_backyard_temperature",
  state: "26.6666666666667",
  attributes: { friendly_name: "Backyard Temperature", device_class: "temperature" },
};

test("a Blink camera reports its own temperature and battery word", () => {
  const { cameras } = readStates([BLINK_CAMERA] as never);
  assert.equal(cameras.length, 1);
  assert.equal(cameras[0].name, "Backyard");
  // From the camera's own attributes — there is no paired sensor here at all.
  assert.equal(cameras[0].temperature, 26.7);
  assert.equal(cameras[0].batteryState, "ok");
  // Blink leaves the percentage null, and a voltage is not a percentage.
  assert.equal(cameras[0].battery, null);
  assert.equal(cameras[0].motionNow, false);
});

test("a sensor whose entity id does not match is still found by name", () => {
  const { cameras } = readStates([BLINK_CAMERA, BLINK_TEMP_SENSOR] as never);
  // The camera's own attribute still wins; the point is that nothing throws
  // and the name-based pairing is what would carry a camera that lacks one.
  assert.equal(cameras[0].temperature, 26.7);

  const bare = {
    ...BLINK_CAMERA,
    attributes: { friendly_name: "Backyard", brand: "Blink" },
  };
  const { cameras: fallback } = readStates([bare, BLINK_TEMP_SENSOR] as never);
  assert.equal(Math.round(fallback[0].temperature!), 27);
});

test("motion on the camera's own attribute counts as motion", () => {
  const moving = {
    ...BLINK_CAMERA,
    attributes: { ...BLINK_CAMERA.attributes, motion_detected: true },
  };
  const { cameras } = readStates([moving] as never);
  assert.equal(cameras[0].motionNow, true);
});

test("a real battery percentage still beats the word", () => {
  const percent = {
    ...BLINK_CAMERA,
    attributes: { ...BLINK_CAMERA.attributes, battery_level: 64, battery: "ok" },
  };
  const { cameras } = readStates([percent] as never);
  assert.equal(cameras[0].battery, 64);
  assert.equal(cameras[0].batteryState, "ok");
});

test("an absent reading is absent, not zero", () => {
  // Number(null) is 0 and Number("") is 0. A camera that has not reported a
  // battery must not read as a flat one.
  const { cameras } = readStates([
    {
      entity_id: "camera.nothing",
      state: "idle",
      attributes: { friendly_name: "Nothing", battery_level: null, temperature_c: "" },
    },
  ] as never);
  assert.equal(cameras[0].battery, null);
  assert.equal(cameras[0].temperature, null);
});

// ------------------------------------------------------------- live view
import { matchSlug, readProxyCameras } from "../src/lib/blink.ts";

// The proxy's real reply, from the Surface.
const PROXY = readProxyCameras({
  cameras: [
    { slug: "backyard", name: "Backyard", id: "211347", hls_url: "/cameras/backyard/hls/index.m3u8" },
    { slug: "front_patio", name: "Front Patio", id: "211360" },
    { slug: "front_yard", name: "Front Yard", id: "211342" },
    { slug: "shed_side", name: "Shed Side", id: "211357" },
    { slug: "side_passage", name: "Side Passage", id: "211338" },
  ],
});

test("the proxy's camera list reduces to slugs and names", () => {
  assert.equal(PROXY.length, 5);
  assert.deepEqual(PROXY[0], { slug: "backyard", name: "Backyard" });
});

test("a bare array is read the same as a wrapped one", () => {
  assert.deepEqual(readProxyCameras([{ slug: "shed_side", name: "Shed Side" }]), [
    { slug: "shed_side", name: "Shed Side" },
  ]);
  assert.deepEqual(readProxyCameras(null), []);
  assert.deepEqual(readProxyCameras({ cameras: [{ name: "No slug" }] }), []);
});

test("Home Assistant entities match the proxy's slugs", () => {
  assert.equal(matchSlug("camera.backyard", "Backyard", PROXY), "backyard");
  assert.equal(matchSlug("camera.front_patio", "Front Patio", PROXY), "front_patio");
  assert.equal(matchSlug("camera.side_passage", "Side Passage", PROXY), "side_passage");
});

test("a differently-named entity still matches on the friendly name", () => {
  // Some integrations prefix the entity id; the names still agree.
  assert.equal(matchSlug("camera.blink_shed_side", "Shed Side", PROXY), "shed_side");
});

test("no match is null, never a guess at the nearest camera", () => {
  assert.equal(matchSlug("camera.nursery", "Nursery", PROXY), null);
  assert.equal(matchSlug("camera.front", "Front", PROXY), null);
});

import { mediaQuery } from "../src/lib/blink.ts";

test("a segment's own token is carried through, never replaced", () => {
  // Straight off a real playlist line: segment_00000.ts?token=4c73...
  const segment = mediaQuery("?token=4c7386a22a78532af3dc0f69", "PROXY-TOKEN");
  assert.equal(segment, "token=4c7386a22a78532af3dc0f69");
});

test("a request with no token of its own gets the proxy's", () => {
  assert.equal(mediaQuery("", "PROXY-TOKEN"), "token=PROXY-TOKEN");
  assert.equal(mediaQuery("?", "PROXY-TOKEN"), "token=PROXY-TOKEN");
});

test("other query parameters survive alongside the token", () => {
  const query = new URLSearchParams(mediaQuery("?seconds=30", "PROXY-TOKEN"));
  assert.equal(query.get("seconds"), "30");
  assert.equal(query.get("token"), "PROXY-TOKEN");
});
