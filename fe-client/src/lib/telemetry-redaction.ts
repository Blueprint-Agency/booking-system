/**
 * Take the studio's name out of the URLs Faro is about to send.
 *
 * On this app the hostname *is* the Tenant — `{slug}.reservetoday.app` — so
 * every browser event Faro builds from `location` carries a real studio's slug:
 * `page_url`, the session and view metadata it attaches on its own, the `url`
 * on a captured fetch or XHR, a `referrer`, even the script names in a
 * stacktrace. Grafana Cloud is a third party, and the tenancy rule
 * (`CLAUDE.md`, and `docs/md/observability-runbook.md` for telemetry) says a
 * studio's name must not reach it. The backend already obeys: its lines carry a
 * `tenantId` uuid and nothing else.
 *
 * So the Tenant label is **replaced, not dropped**. The shape of the URL is what
 * makes an error report worth having — "this happens on the checkout page" —
 * and the studio is still on the event, correctly, as the `tenantId` attribute
 * that `telemetry.ts` sets. Replacing rather than dropping also keeps the
 * reserved labels — `NON_TENANT_LABELS` in `tenant-host.ts`, which no studio
 * can hold — telling themselves apart from a Tenant's.
 *
 * Wired in as Faro's `beforeSend` hook, which is the last thing to touch an
 * event before it leaves the browser — one seam instead of a rewrite at each of
 * the SDK's call sites, several of which are inside the SDK.
 *
 * fe-portal has its own copy: the apps share no code (`CLAUDE.md`), and the
 * portal is on the same slug-shaped hostnames.
 */
import type { BeforeSendHook, TransportItem } from "@grafana/faro-web-sdk";
import { ROOT_DOMAIN, isTenantLabel } from "./tenant-host.ts";

/**
 * What a Tenant's label becomes. `_` is not a legal DNS label character and the
 * backend's slug gate refuses anything that is not one
 * (`be/src/services/tenants/slug.ts`), so no studio can ever hold this name —
 * a redacted hostname can never be read back as a real one.
 */
export const TENANT_URL_PLACEHOLDER = "_tenant";

/** Regex-escape a root domain before it goes into a pattern. */
function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Hostnames on this environment's root domain, wherever they appear in a string
 * — a bare URL, a `next=` query parameter, a sentence in an error message.
 *
 * Three parts. The **boundary** makes the match start at a hostname rather than
 * in the middle of one, so `reservetoday.app` inside `my.reservetoday.appx`
 * is not a root domain; `%2f` is there because an encoded URL nested in a query
 * string has no literal slash in front of its host, and `_` counts as part of a
 * host so that an already-redacted `_tenant.…` is not redacted a second time.
 * The **labels** are
 * everything the host adds to the root domain, leftmost first — the leftmost is
 * the Tenant candidate, and the ones after it (`portal`) come along untouched.
 * The trailing **lookahead** rules out a longer domain that merely starts with
 * ours.
 *
 * Deliberately no lookbehind: Safari only learned it in 16.4, and a `SyntaxError`
 * here would be thrown while building the hook that guards the tenancy rule.
 */
function hostPattern(rootDomain: string): RegExp {
  const root = rootDomain.trim().toLowerCase().replace(/:\d+$/, "").replace(/\.$/, "");
  return new RegExp(`(%2f|^|[^a-z0-9._-])((?:[a-z0-9-]+\\.)+)${escapeForRegExp(root)}(?![a-z0-9.-])`, "gi");
}

/**
 * `value` with the Tenant label of every hostname on the root domain replaced by
 * the placeholder.
 *
 * Paths, queries and uuids are left exactly as they are: a Tenant's uuid may
 * appear in a path, and that is allowed — the rule is about names. A hostname
 * whose leading label is one `isTenantLabel` refuses is returned character for
 * character, so a super-portal or API error still reads as one.
 */
export function redactTenantUrls(value: string, rootDomain: string = ROOT_DOMAIN): string {
  return redactWith(value, hostPattern(rootDomain));
}

function redactWith(value: string, pattern: RegExp): string {
  if (!value) return value;
  return value.replace(pattern, (match: string, boundary: string, labels: string) => {
    // The leftmost label is the Tenant candidate; the rest of the host is not.
    const first = labels.slice(0, labels.indexOf("."));
    if (!isTenantLabel(first)) return match;
    const host = match.slice(boundary.length).toLowerCase();
    return boundary + TENANT_URL_PLACEHOLDER + host.slice(first.length);
  });
}

/** A plain object or array — the only shapes a Faro transport item is built from. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) return false;
  const proto = Object.getPrototypeOf(value) as object | null;
  return proto === Object.prototype || proto === null;
}

/**
 * A copy of `value` with every string in it redacted.
 *
 * A copy, not an edit in place: the `meta` on a transport item is the SDK's own
 * live metadata object, and writing a placeholder into it would leave Faro
 * believing the browser is on a page it has never been on.
 *
 * Class instances are returned as they are rather than rebuilt — Faro can hang
 * the original `Error` off an item, and a redacted `Error` would lose its
 * prototype and its stack. Its parsed stacktrace, which is what actually ships,
 * is plain objects and is redacted.
 */
export function redactTenantUrlsDeep<T>(value: T, rootDomain: string = ROOT_DOMAIN): T {
  return walk(value, hostPattern(rootDomain), new WeakMap()) as T;
}

function walk(value: unknown, pattern: RegExp, seen: WeakMap<object, unknown>): unknown {
  if (typeof value === "string") return redactWith(value, pattern);
  if (Array.isArray(value)) {
    const existing = seen.get(value);
    if (existing) return existing;
    const copy: unknown[] = [];
    seen.set(value, copy);
    for (const entry of value) copy.push(walk(entry, pattern, seen));
    return copy;
  }
  if (isPlainObject(value)) {
    const existing = seen.get(value);
    if (existing) return existing;
    const copy: Record<string, unknown> = {};
    seen.set(value, copy);
    for (const [key, entry] of Object.entries(value)) copy[key] = walk(entry, pattern, seen);
    return copy;
  }
  return value;
}

/**
 * Faro's `beforeSend` hook: redact the item, then let it go.
 *
 * Returning null drops the event, and this does so in exactly one case — a
 * redaction that threw. Letting the item through instead would send the URLs
 * unredacted, which is the bug this file exists to close; a lost event is the
 * cheaper failure. `rootDomain` is the test seam, as in `tenant-host.ts`.
 */
export function tenantUrlRedactor(rootDomain: string = ROOT_DOMAIN): BeforeSendHook {
  const pattern = hostPattern(rootDomain);
  return (item: TransportItem) => {
    try {
      return walk(item, pattern, new WeakMap()) as TransportItem;
    } catch {
      return null;
    }
  };
}
