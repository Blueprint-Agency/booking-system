import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { hasBearer, noteSessionExpiry, onSessionExpired } from "./session-expiry.ts";

afterEach(() => onSessionExpired(null));

function counting(): { calls: () => number } {
  let n = 0;
  onSessionExpired(() => {
    n += 1;
  });
  return { calls: () => n };
}

test("a 401 on a call that sent a bearer token ends the session", () => {
  const seen = counting();
  assert.equal(noteSessionExpiry(401, true), true);
  assert.equal(seen.calls(), 1);
});

test("a 401 on an anonymous call leaves the session alone", () => {
  const seen = counting();
  assert.equal(noteSessionExpiry(401, false), false);
  assert.equal(seen.calls(), 0);
});

test("other statuses leave the session alone, 403 included", () => {
  const seen = counting();
  for (const status of [200, 400, 403, 404, 500]) noteSessionExpiry(status, true);
  assert.equal(seen.calls(), 0);
});

test("hasBearer reads the Authorization header", () => {
  assert.equal(hasBearer(new Headers({ Authorization: "Bearer abc" })), true);
  assert.equal(hasBearer(new Headers({ Authorization: "Bearer " })), false);
  assert.equal(hasBearer(new Headers({ Authorization: "Bearer null" })), true);
  assert.equal(hasBearer(new Headers()), false);
});
