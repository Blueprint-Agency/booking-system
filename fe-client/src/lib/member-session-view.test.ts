import { test } from "node:test";
import assert from "node:assert/strict";
import { memberSessionView, type SessionStoreValue } from "./member-session-view.ts";

const signedIn: SessionStoreValue = {
  data: { user: { id: "u1", email: "member@northwind.test" }, session: { claimedTenantId: "t1" } },
  isPending: false,
};
const signedOut: SessionStoreValue = { data: null, isPending: false };
const pending: SessionStoreValue = { data: null, isPending: true };

test("before hydration the session reads as not loaded, whatever the store already holds", () => {
  // The server renders every session-dependent page loading; the hydrating
  // render must draw the same, even when the store settled first.
  const unloaded = { isLoaded: false, isSignedIn: false, session: null };
  assert.deepEqual(memberSessionView(false, signedOut), unloaded);
  assert.deepEqual(memberSessionView(false, signedIn), unloaded);
  assert.deepEqual(memberSessionView(false, pending), unloaded);
});

test("after hydration the store's answer is read", () => {
  assert.deepEqual(memberSessionView(true, pending), { isLoaded: false, isSignedIn: false, session: null });
  assert.deepEqual(memberSessionView(true, signedOut), { isLoaded: true, isSignedIn: false, session: null });
  assert.deepEqual(memberSessionView(true, signedIn), {
    isLoaded: true,
    isSignedIn: true,
    session: { userId: "u1", email: "member@northwind.test", claimedTenantId: "t1" },
  });
});

test("a background re-read keeps a known session loaded", () => {
  const view = memberSessionView(true, { ...signedIn, isPending: true });
  assert.equal(view.isLoaded, true);
  assert.equal(view.session?.userId, "u1");
});

test("a session with no studio claim reads claimedTenantId as null", () => {
  const view = memberSessionView(true, { ...signedIn, data: { ...signedIn.data!, session: {} } });
  assert.equal(view.session?.claimedTenantId, null);
});

// ── An unreadable session is not a signed-out one (#500) ─────────────────────

const failed = (error: unknown, data: SessionStoreValue["data"] = null): SessionStoreValue => ({
  data,
  isPending: false,
  error,
});

test("ACC-63 a session read that failed with a token held is unknown, never signed out", () => {
  const causes: unknown[] = [
    { status: 500, statusText: "Internal Server Error" },
    { status: 502, statusText: "Bad Gateway" },
    new TypeError("Failed to fetch"),
    new Error("The operation timed out"),
  ];
  for (const cause of causes) {
    const view = memberSessionView(true, failed(cause), true);
    assert.equal(view.failure, cause);
    assert.equal(view.isSignedIn, false);
    // Not loaded: no page may draw a signed-out version of itself under it.
    assert.equal(view.isLoaded, false);
    assert.equal(view.session, null);
  }
});

test("ACC-63 a browser with no token is signed out whatever the read said", () => {
  const view = memberSessionView(true, failed({ status: 500, statusText: "Internal Server Error" }), false);
  assert.deepEqual(view, { isLoaded: true, isSignedIn: false, session: null });
  assert.deepEqual(memberSessionView(true, failed(new TypeError("Failed to fetch"))), {
    isLoaded: true,
    isSignedIn: false,
    session: null,
  });
});

test("ACC-63 a 401 is signed out, with or without a token", () => {
  for (const hasToken of [true, false]) {
    assert.deepEqual(memberSessionView(true, failed({ status: 401, statusText: "Unauthorized" }), hasToken), {
      isLoaded: true,
      isSignedIn: false,
      session: null,
    });
  }
});

test("ACC-63 a refusal the app answers elsewhere keeps the session loading", () => {
  const answered = [
    { status: 403, statusText: "Forbidden", error: "tenant_suspended" },
    { status: 403, statusText: "Forbidden", error: "tenant_mismatch" },
    { status: 503, statusText: "Service Unavailable", error: "maintenance", message: "Back soon" },
  ];
  for (const refusal of answered) {
    assert.deepEqual(memberSessionView(true, failed(refusal), true), {
      isLoaded: false,
      isSignedIn: false,
      session: null,
    });
  }
});

test("ACC-63 a failed re-read that kept the session leaves the member signed in", () => {
  const view = memberSessionView(true, failed({ status: 500, statusText: "Internal Server Error" }, signedIn.data), true);
  assert.equal(view.isSignedIn, true);
  assert.equal(view.isLoaded, true);
  assert.equal(view.session?.userId, "u1");
  assert.equal(view.failure, undefined);
});

test("ACC-63 before hydration a failed read is still not loaded, and not unknown", () => {
  assert.deepEqual(memberSessionView(false, failed({ status: 500, statusText: "x" }), true), {
    isLoaded: false,
    isSignedIn: false,
    session: null,
  });
});
