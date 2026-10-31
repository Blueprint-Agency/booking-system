// Staff attention: the bell's wire shapes and the rules around them that need no
// React. Mirrors be/src/services/attention (`/portal/attention`).

/** `GET /portal/attention/summary`. `by_group` keys are the sidebar badges'. */
export interface AttentionSummary {
  needs_action: number;
  unread_updates: number;
  total: number;
  by_group: Partial<
    Record<"pt_requests" | "corporate_requests" | "leave" | "check_in" | "classpass", number>
  >;
}

export interface AttentionItem {
  /** `kind:subject_id`. */
  id: string;
  kind: string;
  title: string;
  detail: string;
  href: string | null;
  location: { id: string; name: string } | null;
  occurred_at: string;
  dismissable: boolean;
}

/** A page that lists items the panel cut short: one per page a group's kinds link to. */
export interface AttentionSeeAll {
  href: string;
  /** What the page is called ("Leave"), to tell two links in one group apart. */
  label: string;
  count: number;
}

export interface AttentionGroup {
  key: string;
  label: string;
  count: number;
  /** The one page that lists the group, when one kind makes it up; null when several do. */
  see_all_href: string | null;
  see_all: AttentionSeeAll[];
  items: AttentionItem[];
}

/**
 * The text of a "See all" link: "See all 4", or, where the group has more than
 * one such link, "See all 4 Leave" so they can be told apart.
 */
export function seeAllText(link: AttentionSeeAll, linksInGroup: number): string {
  return linksInGroup > 1 && link.label ? `See all ${link.count} ${link.label}` : `See all ${link.count}`;
}

export interface AttentionUpdate {
  id: string;
  kind: string;
  title: string;
  detail: string | null;
  href: string | null;
  created_at: string;
  read_at: string | null;
}

/** `GET /portal/attention`. */
export interface AttentionPanelData {
  needs_action: { groups: AttentionGroup[] };
  updates: { items: AttentionUpdate[]; next_cursor: string | null };
}

// ── The Updates tab ─────────────────────────────────────────────────────────

/** The tab's label: the unread count beside it, nothing when all are read. */
export function updatesTabLabel(unread: number): string {
  return unread > 0 ? `Updates (${unread} new)` : "Updates";
}

export function unreadCount(updates: readonly AttentionUpdate[]): number {
  return updates.filter((u) => u.read_at === null).length;
}

/** Opening an update marks it read: the list shows that at once, without a refetch. */
export function markUpdateReadLocally(
  updates: readonly AttentionUpdate[],
  id: string,
  at: string,
): AttentionUpdate[] {
  return updates.map((u) => (u.id === id && u.read_at === null ? { ...u, read_at: at } : u));
}

export function markAllReadLocally(updates: readonly AttentionUpdate[], at: string): AttentionUpdate[] {
  return updates.map((u) => (u.read_at === null ? { ...u, read_at: at } : u));
}

/** "Show older": the next page goes on the end, and an update already shown is not shown twice. */
export function appendOlder(
  shown: readonly AttentionUpdate[],
  older: readonly AttentionUpdate[],
): AttentionUpdate[] {
  const have = new Set(shown.map((u) => u.id));
  return [...shown, ...older.filter((u) => !have.has(u.id))];
}

/**
 * The red bubble's text: nothing at 0, the number to 99, then "99+". When the
 * summary could not be read (`unchecked`) it is "!", never nothing: no bubble
 * would say that nothing needs attention.
 */
export function bubbleText(total: number, unchecked = false): string | null {
  if (unchecked) return "!";
  if (!(total > 0)) return null;
  return total > 99 ? "99+" : String(total);
}

/** What a screen reader hears for the bell: the real count, not the capped one. */
export function bellLabel(total: number, unchecked = false): string {
  if (unchecked) return "Notifications, couldn't check what needs attention";
  return total > 0 ? `Notifications, ${total} need attention` : "Notifications";
}

/** The Needs action tab: a count only once the summary has been read. */
export function needsActionTabLabel(count: number | null): string {
  return count === null ? "Needs action" : `Needs action (${count})`;
}

// ── Auto-open: once per sign-in ─────────────────────────────────────────────

/** The two `Storage` methods this needs, so a test can stand in for it. */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/**
 * Where "the panel already had its chance this sign-in" is remembered. Derived
 * from the session token so a new sign-in is a new decision, and shortened so
 * the token itself is never written into a storage key.
 */
export function autoOpenKey(sessionToken: string): string {
  let hash = 5381;
  for (let i = 0; i < sessionToken.length; i++) {
    hash = ((hash << 5) + hash + sessionToken.charCodeAt(i)) | 0;
  }
  return `rt.attention.autoOpen.${(hash >>> 0).toString(36)}`;
}

/**
 * What the first answer after sign-in does. It decides once, whatever the count:
 * a quiet sign-in must not open the panel on a request that arrives an hour
 * later.
 */
export function autoOpenDecision(input: {
  needsAction: number;
  alreadyDecided: boolean;
}): { open: boolean; remember: boolean } {
  if (input.alreadyDecided) return { open: false, remember: false };
  return { open: input.needsAction > 0, remember: true };
}

/** Whether this sign-in has been through `autoOpenDecision`. Blocked storage reads as "no". */
export function wasAutoOpenDecided(store: StorageLike | null, key: string): boolean {
  try {
    return store?.getItem(key) === "1";
  } catch {
    return false;
  }
}

/** Remember it. Blocked storage drops the write: the panel may open again on a reload, which is harmless. */
export function rememberAutoOpenDecided(store: StorageLike | null, key: string): void {
  try {
    store?.setItem(key, "1");
  } catch {
    // Storage blocked (a locked-down profile or private window).
  }
}

// ── Deep links ──────────────────────────────────────────────────────────────

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The `?request=` a bell link carries, or null when absent or not an id. */
export function requestParam(search: string): string | null {
  const id = new URLSearchParams(search).get("request");
  return id && UUID.test(id) ? id : null;
}

/** The `?review=` a bell link carries to the ClassPass page, or null when absent or not an id. */
export function reviewParam(search: string): string | null {
  const id = new URLSearchParams(search).get("review");
  return id && UUID.test(id) ? id : null;
}

/** The `?purchase=` a bell link carries to Partial payments, or null when absent or not an id. */
export function purchaseParam(search: string): string | null {
  const id = new URLSearchParams(search).get("purchase");
  return id && UUID.test(id) ? id : null;
}

/** A list with the wanted row first, so a deep link's row is on the first page. Unchanged if it isn't there. */
export function withWantedFirst<T>(
  rows: readonly T[],
  wanted: string | null,
  idOf: (row: T) => string | null = (r) => (r as { id: string }).id,
): T[] {
  const at = wanted ? rows.findIndex((r) => idOf(r) === wanted) : -1;
  if (at < 0) return [...rows];
  return [rows[at]!, ...rows.slice(0, at), ...rows.slice(at + 1)];
}

/** Whether a row's purchase is the one the bell linked to (the row to highlight). */
export function isWantedPurchase(purchaseId: string | null, wanted: string | null): boolean {
  return purchaseId !== null && wanted !== null && purchaseId === wanted;
}

// ── Dismissals ──────────────────────────────────────────────────────────────

/** The body of `POST /portal/attention/dismissals` for an item id (`kind:subject_id`). */
export function dismissalBody(itemId: string): { kind: string; subject_id: string } {
  const at = itemId.indexOf(":");
  return { kind: itemId.slice(0, at), subject_id: itemId.slice(at + 1) };
}

/** A dismissed item leaves the panel at once; its group's count follows, and an empty group goes. */
export function removeItemLocally(groups: readonly AttentionGroup[], itemId: string): AttentionGroup[] {
  return groups
    .map((g) =>
      g.items.some((i) => i.id === itemId)
        ? { ...g, count: Math.max(0, g.count - 1), items: g.items.filter((i) => i.id !== itemId) }
        : g,
    )
    .filter((g) => g.count > 0);
}

/** The `?location=` a bell link carries, if it is one of the caller's own locations. */
export function locationParam(search: string, accessibleIds: readonly string[]): string | null {
  const id = new URLSearchParams(search).get("location");
  return id && accessibleIds.includes(id) ? id : null;
}

/** The location a bell link names, read off its href (null for no link or no location). */
export function locationFromHref(href: string | null): string | null {
  if (!href) return null;
  const at = href.indexOf("?");
  if (at < 0) return null;
  const id = new URLSearchParams(href.slice(at)).get("location");
  return id && UUID.test(id) ? id : null;
}

/** A query string without the named params, with its `?` (or "" when none are left). */
export function withoutParams(search: string, names: readonly string[]): string {
  const params = new URLSearchParams(search);
  for (const name of names) params.delete(name);
  const rest = params.toString();
  return rest ? `?${rest}` : "";
}
