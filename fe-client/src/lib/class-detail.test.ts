import { test } from "node:test";
import assert from "node:assert/strict";
import { classLength, seatsLine } from "./class-detail.ts";

const at = (hhmm: string) => `2026-10-01T${hhmm}:00.000Z`;

test("a class's length reads in minutes up to an hour, then in hours", () => {
  assert.equal(classLength(at("01:00"), at("01:45")), "45 min");
  assert.equal(classLength(at("01:00"), at("02:00")), "60 min");
  assert.equal(classLength(at("01:00"), at("02:30")), "1 hr 30 min");
  assert.equal(classLength(at("01:00"), at("03:00")), "2 hr");
});

test("free seats are counted", () => {
  const line = { enabled: true, open: true, waiting: 0 };
  assert.equal(seatsLine(5, line), "5 spots left");
  assert.equal(seatsLine(1, line), "1 spot left");
});

test("a full class says where its line stands, where the studio runs one", () => {
  assert.equal(seatsLine(0, { enabled: true, open: true, waiting: 2 }), "Full · waitlist open, 2 waiting");
  assert.equal(seatsLine(0, { enabled: true, open: true, waiting: 0 }), "Full · waitlist open");
  assert.equal(seatsLine(0, { enabled: true, open: false, waiting: 3 }), "Full · waitlist closed");
  assert.equal(seatsLine(0, { enabled: false, open: false, waiting: 0 }), "Full");
});
