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

test("CAT-11 a class with free seats reads Available, never how many", () => {
  assert.equal(seatsLine(true, { enabled: true, open: true }), "Available");
  assert.equal(seatsLine(true, { enabled: false, open: false }), "Available");
});

test("CAT-11 a full class says whether its line is open, never how long it is, where the studio runs one", () => {
  assert.equal(seatsLine(false, { enabled: true, open: true }), "Full · waitlist open");
  assert.equal(seatsLine(false, { enabled: true, open: false }), "Full · waitlist closed");
  assert.equal(seatsLine(false, { enabled: false, open: false }), "Full");
});
