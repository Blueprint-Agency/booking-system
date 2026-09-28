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
