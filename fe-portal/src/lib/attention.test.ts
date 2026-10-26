import test from "node:test";
import assert from "node:assert";
import {
  autoOpenDecision,
  autoOpenKey,
  bellLabel,
  bubbleText,
  locationFromHref,
  locationParam,
  rememberAutoOpenDecided,
  requestParam,
  wasAutoOpenDecided,
  withoutParams,
  type StorageLike,
} from "./attention";

const memoryStore = (): StorageLike & { data: Map<string, string> } => {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
  };
};

test("ATN-11 the bubble is hidden at 0, shows the number up to 99 and reads 99+ above it; the bell says how many need attention", () => {
  assert.equal(bubbleText(0), null);
  assert.equal(bubbleText(-3), null);
  assert.equal(bubbleText(1), "1");
  assert.equal(bubbleText(99), "99");
  assert.equal(bubbleText(100), "99+");
  assert.equal(bubbleText(4000), "99+");
  assert.equal(bellLabel(3), "Notifications, 3 need attention");
  assert.equal(bellLabel(150), "Notifications, 150 need attention", "the label is the real count, not the capped one");
  assert.equal(bellLabel(0), "Notifications");
});

test("ATN-12 a deep link's request and location are read from the query; a malformed or unreachable one is ignored", () => {
  const id = "3f2b8c1e-5d4a-4b6c-9e7f-0a1b2c3d4e5f";
  const loc = "a1b2c3d4-0000-4000-8000-000000000001";
  assert.equal(requestParam(`?request=${id}`), id);
  assert.equal(requestParam(`?location=${loc}&request=${id}`), id);
  assert.equal(requestParam(""), null);
  assert.equal(requestParam("?request=not-an-id"), null);
  assert.equal(requestParam("?request="), null);

  assert.equal(locationParam(`?location=${loc}`, [loc]), loc);
  assert.equal(locationParam(`?location=${loc}`, ["someone-elses"]), null, "a location the caller cannot reach is not switched to");
  assert.equal(locationParam("", [loc]), null);

  assert.equal(withoutParams(`?location=${loc}&request=${id}`, ["location"]), `?request=${id}`);
  assert.equal(withoutParams(`?location=${loc}`, ["location"]), "");
  assert.equal(withoutParams("?tab=a", ["location"]), "?tab=a");

  assert.equal(locationFromHref(`/admin/pt-requests?request=${id}&location=${loc}`), loc);
  assert.equal(locationFromHref("/admin/pt-requests"), null);
  assert.equal(locationFromHref(null), null);
});

test("ATN-13 the panel opens by itself once per sign-in, and only when something needs action", () => {
  // The first answer after sign-in decides, whatever it is.
  assert.deepEqual(autoOpenDecision({ needsAction: 2, alreadyDecided: false }), { open: true, remember: true });
  assert.deepEqual(autoOpenDecision({ needsAction: 0, alreadyDecided: false }), { open: false, remember: true });
  // Later answers in the same sign-in never reopen it.
  assert.deepEqual(autoOpenDecision({ needsAction: 5, alreadyDecided: true }), { open: false, remember: false });

  const a = autoOpenKey("session-token-aaaaaaaaaaaa");
  const b = autoOpenKey("session-token-bbbbbbbbbbbb");
  assert.notEqual(a, b, "a new sign-in is a new decision");
  assert.ok(!a.includes("session-token-aaaaaaaaaaaa"), "the token itself is not written into a storage key");
  assert.equal(autoOpenKey("session-token-aaaaaaaaaaaa"), a);
});

test("ATN-14 the auto-open memory survives a blocked sessionStorage: reads say 'not yet', writes are dropped, nothing throws", () => {
  const store = memoryStore();
  const key = autoOpenKey("session-token-aaaaaaaaaaaa");
  assert.equal(wasAutoOpenDecided(store, key), false);
  rememberAutoOpenDecided(store, key);
  assert.equal(wasAutoOpenDecided(store, key), true);
  assert.equal(wasAutoOpenDecided(store, autoOpenKey("session-token-bbbbbbbbbbbb")), false);

  const blocked: StorageLike = {
    getItem: () => {
      throw new Error("SecurityError");
    },
    setItem: () => {
      throw new Error("SecurityError");
    },
  };
  assert.equal(wasAutoOpenDecided(blocked, key), false);
  assert.doesNotThrow(() => rememberAutoOpenDecided(blocked, key));
  assert.equal(wasAutoOpenDecided(null, key), false);
  assert.doesNotThrow(() => rememberAutoOpenDecided(null, key));
});
