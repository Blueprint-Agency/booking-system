import { test } from "node:test";
import assert from "node:assert/strict";
import { isSkippedViewTransition } from "./view-transition-noise.ts";

function domError(name: string, message: string): Error {
  const e = new Error(message);
  e.name = name;
  return e;
}

test("a transition skipped because the tab is hidden is not an error, with or without Chrome's added reason", () => {
  assert.equal(
    isSkippedViewTransition(domError("InvalidStateError", "Transition was aborted because of invalid state. Document hidden")),
    true,
  );
  assert.equal(
    isSkippedViewTransition(domError("InvalidStateError", "Transition was aborted because of invalid state")),
    true,
  );
  assert.equal(
    isSkippedViewTransition(
      domError("InvalidStateError", "Skipping view transition because document visibility state has become hidden."),
    ),
    true,
  );
});

test("any other error is still reported", () => {
  assert.equal(isSkippedViewTransition(domError("InvalidStateError", "The object is in an invalid state.")), false);
  assert.equal(isSkippedViewTransition(domError("AbortError", "Transition was aborted because of invalid state")), false);
  assert.equal(isSkippedViewTransition(new TypeError("x is undefined")), false);
  assert.equal(isSkippedViewTransition("Transition was aborted because of invalid state"), false);
  assert.equal(isSkippedViewTransition(null), false);
});
