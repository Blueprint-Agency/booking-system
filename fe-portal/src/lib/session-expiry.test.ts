import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { ApiError, apiFetch } from "./api";
import { bearerToken, hasBearer, noteSessionExpiry, onSessionExpired } from "./session-expiry";

const realFetch = globalThis.fetch;
afterEach(() => {
  onSessionExpired(null);
  globalThis.fetch = realFetch;
});

function expiries(): { seen: Array<string | undefined> } {
  const seen: Array<string | undefined> = [];
  onSessionExpired((token) => seen.push(token));
  return { seen };
}

function answering(status: number, body: unknown = { error: "x" }): typeof fetch {
  return (async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    })) as typeof fetch;
}

test("ADM-08 a 401 on a call that sent a bearer token ends the portal session, with the token it sent", () => {
  const { seen } = expiries();
  assert.equal(noteSessionExpiry(401, true, "tok-1"), true);
  assert.deepEqual(seen, ["tok-1"]);
});

test("ADM-08 a 401 on an anonymous call, and every other status, leave the session alone", () => {
  const { seen } = expiries();
  assert.equal(noteSessionExpiry(401, false), false);
  for (const status of [200, 400, 403, 404, 500, 503]) noteSessionExpiry(status, true, "tok-1");
  assert.deepEqual(seen, []);
});

test("ADM-08 hasBearer and bearerToken read the Authorization header", () => {
  assert.equal(hasBearer(new Headers({ Authorization: "Bearer abc" })), true);
  assert.equal(hasBearer(new Headers()), false);
  assert.equal(bearerToken(new Headers({ Authorization: "Bearer abc" })), "abc");
});

test("ADM-08 a portal call that sent a token and was answered 401 ends the session, however the screen handles the error", async () => {
  const { seen } = expiries();
  globalThis.fetch = answering(401, { error: "unauthorized" });
  await assert.rejects(
    apiFetch("/portal/admin/staff", async () => "tok-live"),
    (err: unknown) => err instanceof ApiError && err.status === 401,
  );
  assert.deepEqual(seen, ["tok-live"]);
});

test("ADM-08 a portal call with no token, or answered with a 403 or a 500, does not end the session", async () => {
  const { seen } = expiries();
  globalThis.fetch = answering(401, { error: "unauthorized" });
  await assert.rejects(apiFetch("/portal/x", async () => null));
  globalThis.fetch = answering(403, { error: "forbidden_permission" });
  await assert.rejects(apiFetch("/portal/x", async () => "tok-live"));
  globalThis.fetch = answering(500, { error: "internal_error" });
  await assert.rejects(apiFetch("/portal/x", async () => "tok-live"));
  assert.deepEqual(seen, []);
});
