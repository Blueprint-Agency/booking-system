import { test } from "node:test";
import assert from "node:assert/strict";
import { cancelWindowPlaceholder, cancelWindowText, parseCancelWindow } from "./cancel-window";

// A class's own Cancellation Window (#313): optional, and blank means the
// studio's, which the placeholder states.

test("the placeholder names the studio's window once it is known", () => {
  assert.equal(cancelWindowPlaceholder(24), "Studio default · 24h");
  assert.equal(cancelWindowPlaceholder(0), "Studio default · 0h");
  assert.equal(cancelWindowPlaceholder(null), "Studio default");
});

test("blank is the studio default; whole hours from 0 are the class's own", () => {
  assert.deepEqual(parseCancelWindow(""), { ok: true, hours: null });
  assert.deepEqual(parseCancelWindow("  "), { ok: true, hours: null });
  assert.deepEqual(parseCancelWindow("0"), { ok: true, hours: 0 });
  assert.deepEqual(parseCancelWindow("48"), { ok: true, hours: 48 });
  assert.deepEqual(parseCancelWindow(" 6 "), { ok: true, hours: 6 });
});

test("a saved window shows as typed text, and round-trips; none shows blank", () => {
  assert.equal(cancelWindowText(null), "");
  assert.equal(cancelWindowText(0), "0");
  assert.deepEqual(parseCancelWindow(cancelWindowText(12)), { ok: true, hours: 12 });
  assert.deepEqual(parseCancelWindow(cancelWindowText(null)), { ok: true, hours: null });
});

test("anything else is refused with a sentence, never sent", () => {
  for (const raw of ["-1", "1.5", "abc", "1e2x"]) {
    const res = parseCancelWindow(raw);
    assert.equal(res.ok, false, raw);
    if (!res.ok) assert.equal(res.message, "The cancellation window must be a whole number of hours, 0 or more.");
  }
});
