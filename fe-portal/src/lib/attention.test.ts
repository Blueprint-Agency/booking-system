import test from "node:test";
import assert from "node:assert";
import {
  dismissalBody,
  isWantedPurchase,
  purchaseParam,
  removeItemLocally,
  seeAllText,
  withWantedFirst,
  type AttentionGroup,
  type AttentionItem,
  appendOlder,
  markAllReadLocally,
  markUpdateReadLocally,
  unreadCount,
  updatesTabLabel,
  type AttentionUpdate,
  autoOpenDecision,
  autoOpenKey,
  bellLabel,
  bubbleText,
  needsActionTabLabel,
  locationFromHref,
  locationParam,
  rememberAutoOpenDecided,
  requestParam,
  reviewParam,
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

test("ATN-84 the ClassPass page's ?review= is read only when it is an id", () => {
  const id = "0f8fad5b-d9cb-469f-a165-70867728950e";
  assert.equal(reviewParam(`?review=${id}`), id);
  assert.equal(reviewParam(`?location=x&review=${id}`), id);
  assert.equal(reviewParam(""), null);
  assert.equal(reviewParam("?review=nope"), null);
  assert.equal(reviewParam(`?request=${id}`), null);
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

const update = (id: string, read_at: string | null = null): AttentionUpdate => ({
  id,
  kind: "leave_decided",
  title: `t${id}`,
  detail: null,
  href: null,
  created_at: "2026-10-27T00:00:00.000Z",
  read_at,
});

test("ATN-149 the Updates tab: its label counts the unread, opening one or all marks them read in place, and an older page is appended without repeats", () => {
  assert.equal(updatesTabLabel(0), "Updates");
  assert.equal(updatesTabLabel(3), "Updates (3 new)");

  const list = [update("a"), update("b"), update("c", "2026-10-26T00:00:00.000Z")];
  assert.equal(unreadCount(list), 2);

  const at = "2026-10-27T01:00:00.000Z";
  const one = markUpdateReadLocally(list, "a", at);
  assert.equal(one[0]!.read_at, at);
  assert.equal(one[1]!.read_at, null);
  assert.equal(list[0]!.read_at, null, "the original list is not mutated");
  // Already read keeps its first time.
  assert.equal(markUpdateReadLocally(list, "c", at)[2]!.read_at, "2026-10-26T00:00:00.000Z");

  const all = markAllReadLocally(list, at);
  assert.equal(unreadCount(all), 0);
  assert.equal(all[2]!.read_at, "2026-10-26T00:00:00.000Z");

  const merged = appendOlder(list, [update("c"), update("d")]);
  assert.deepEqual(
    merged.map((u) => u.id),
    ["a", "b", "c", "d"],
  );
});

test("ATN-57 a dismissal is posted with the item's kind and subject, the row goes at once, and the group count and emptiness follow", () => {
  const id = "3f2b8c1e-5d4a-4b6c-9e7f-0a1b2c3d4e5f";
  assert.deepEqual(dismissalBody(`part_payment_silent:${id}`), { kind: "part_payment_silent", subject_id: id });

  const item = (n: string): AttentionItem => ({
    id: `part_payment_silent:${n}`,
    kind: "part_payment_silent",
    title: n,
    detail: "",
    href: null,
    location: null,
    occurred_at: "2026-10-26T00:00:00.000Z",
    dismissable: true,
  });
  const groups: AttentionGroup[] = [
    { key: "payments_refunds", label: "Payments & refunds", count: 2, see_all_href: null, see_all: [], items: [item("a"), item("b")] },
    { key: "requests", label: "Requests", count: 1, see_all_href: null, see_all: [], items: [item("c")] },
  ];
  const after = removeItemLocally(groups, "part_payment_silent:a");
  assert.deepEqual(after[0]!.items.map((i) => i.id), ["part_payment_silent:b"]);
  assert.equal(after[0]!.count, 1);
  assert.equal(removeItemLocally(after, "part_payment_silent:b").length, 1, "an emptied group is dropped");
});

test("ATN-192 a See all link reads 'See all {n}', and names its page when the group has more than one", () => {
  const leave = { href: "/admin/leave", label: "Leave", count: 7 };
  const corporate = { href: "/admin/corporate-requests", label: "Corporate requests", count: 3 };
  assert.equal(seeAllText(leave, 1), "See all 7");
  assert.equal(seeAllText(leave, 2), "See all 7 Leave");
  assert.equal(seeAllText(corporate, 2), "See all 3 Corporate requests");
  assert.equal(seeAllText({ ...leave, label: "" }, 2), "See all 7", "a link with no page name falls back to the count alone");
});

test("ATN-58 Partial payments reads ?purchase= and lists that purchase first", () => {
  const id = "3f2b8c1e-5d4a-4b6c-9e7f-0a1b2c3d4e5f";
  assert.equal(purchaseParam(`?purchase=${id}`), id);
  assert.equal(purchaseParam("?purchase=nope"), null);
  assert.equal(purchaseParam(""), null);
  const rows = [{ id: "x" }, { id }, { id: "y" }];
  assert.deepEqual(withWantedFirst(rows, id).map((r) => r.id), [id, "x", "y"]);
  assert.deepEqual(withWantedFirst(rows, null), rows);
  assert.deepEqual(withWantedFirst(rows, "missing"), rows, "a purchase that is gone opens the page as normal");
});

test("ATN-99 the member page lists the wanted purchase first, whichever field carries the purchase id, and knows which row to highlight", () => {
  const id = "3f2b8c1e-5d4a-4b6c-9e7f-0a1b2c3d4e5f";
  const places = [
    { booking_id: "b1", purchase_id: "p1" },
    { booking_id: "b2", purchase_id: id },
    { booking_id: "b3", purchase_id: null },
  ];
  const byPurchase = (p: { purchase_id: string | null }) => p.purchase_id;
  assert.deepEqual(withWantedFirst(places, id, byPurchase).map((p) => p.booking_id), ["b2", "b1", "b3"]);
  assert.deepEqual(withWantedFirst(places, "p-gone", byPurchase), places, "a purchase that is gone opens the page as normal");
  assert.equal(isWantedPurchase(id, id), true);
  assert.equal(isWantedPurchase("p1", id), false);
  assert.equal(isWantedPurchase(null, id), false);
  assert.equal(isWantedPurchase(id, null), false);
});

test("ADM-02 a bell whose summary could not be read says so, instead of showing no bubble", () => {
  assert.equal(bubbleText(0, true), "!");
  assert.equal(bubbleText(7, true), "!");
  assert.equal(bellLabel(0, true), "Notifications, couldn't check what needs attention");
  // A summary that did load is unchanged.
  assert.equal(bubbleText(0, false), null);
  assert.equal(bellLabel(3, false), "Notifications, 3 need attention");
});

test("ADM-02 the Needs action tab shows a count only when the summary loaded", () => {
  assert.equal(needsActionTabLabel(0), "Needs action (0)");
  assert.equal(needsActionTabLabel(4), "Needs action (4)");
  assert.equal(needsActionTabLabel(null), "Needs action");
});
