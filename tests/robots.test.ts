import assert from "node:assert/strict";
import { test } from "node:test";
import {
  describeRobotCommand,
  readRobots,
  serviceFor,
  validRobotId,
} from "../src/lib/robots.ts";

const state = (entity_id: string, state: string, attributes = {}) => ({
  entity_id,
  state,
  attributes,
  last_updated: "2026-09-10T04:00:00Z",
});

test("the two domains map onto one set of buttons", () => {
  assert.deepEqual(serviceFor("vacuum.roomba", "start"), {
    domain: "vacuum",
    service: "start",
  });
  assert.deepEqual(serviceFor("vacuum.roomba", "dock"), {
    domain: "vacuum",
    service: "return_to_base",
  });
  // The mower domain names the same three things differently.
  assert.deepEqual(serviceFor("lawn_mower.mammotion", "start"), {
    domain: "lawn_mower",
    service: "start_mowing",
  });
  assert.deepEqual(serviceFor("lawn_mower.mammotion", "dock"), {
    domain: "lawn_mower",
    service: "dock",
  });
  assert.deepEqual(serviceFor("lawn_mower.mammotion", "pause"), {
    domain: "lawn_mower",
    service: "pause",
  });
});

test("only vacuum and mower entities are ever put in a URL", () => {
  assert.equal(validRobotId("vacuum.roomba"), true);
  assert.equal(validRobotId("lawn_mower.mammotion"), true);
  assert.equal(validRobotId("light.kitchen"), false);
  assert.equal(validRobotId("vacuum.roomba/../../states"), false);
  assert.equal(validRobotId("lock.front_door"), false);
});

test("running and docked are read across both vocabularies", () => {
  const robots = readRobots([
    state("vacuum.roomba", "cleaning", { battery_level: 64 }),
    state("lawn_mower.mower", "mowing"),
    state("vacuum.other", "docked"),
    state("light.kitchen", "on"),
  ]);
  assert.deepEqual(
    robots.map((robot) => [robot.name, robot.kind, robot.running, robot.docked]),
    [
      ["mower", "mower", true, false],
      ["other", "vacuum", false, true],
      ["roomba", "vacuum", true, false],
    ],
  );
  assert.equal(robots.find((robot) => robot.name === "roomba")?.battery, 64);
});

test("a stuck or missing robot says so", () => {
  const robots = readRobots([
    state("vacuum.roomba", "error", { error: "Side brush stuck" }),
    state("lawn_mower.mower", "unavailable"),
  ]);
  // Looked up by name: the list is sorted, so an index here would be asserting
  // the alphabet rather than the behaviour.
  const by = (name: string) => robots.find((robot) => robot.name === name)?.problem;
  assert.equal(by("roomba"), "Side brush stuck");
  assert.equal(by("mower"), "Not responding");
});

test("the activity line says which way the robot went", () => {
  assert.equal(describeRobotCommand("Roomba", "start"), "Sent Roomba out");
  assert.equal(describeRobotCommand("Roomba", "dock"), "Sent Roomba home");
  assert.equal(describeRobotCommand("Roomba", "pause"), "Paused Roomba");
});
