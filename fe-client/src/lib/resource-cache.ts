"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * What the app has already read from the backend during this visit, keyed by
 * what was asked for. A page the member comes back to draws what it showed
 * last time straight away and re-reads it quietly behind the scenes, rather
 * than blanking into the spinner on every visit (stale-while-revalidate).
 *
 * Module state, so it lives as long as the tab's JavaScript does: a reload
 * starts empty. It is one hostname's, so one studio's. A key that depends on
 * who is signed in must carry the member's id, so one member's reads are never
 * drawn for another who signs in on the same tab.
 */
const values = new Map<string, unknown>();
const inflight = new Map<string, Promise<unknown>>();

export function cachedValue<T>(key: string): T | undefined {
  return values.get(key) as T | undefined;
}

/**
 * Read `key`, sharing one request between everyone who asks while it is in
 * flight. A failure is thrown to every waiter and leaves the last good value.
 * `fresh` starts a new read even if one is in flight — after a change the
 * member made, a read that set off before it would answer with the old state.
 */
export function fetchCached<T>(key: string, fetcher: () => Promise<T>, fresh = false): Promise<T> {
  const running = inflight.get(key);
  if (running && !fresh) return running as Promise<T>;
  const p: Promise<T> = fetcher()
    .then((value) => {
      // A newer read has started since: its answer is the one to keep, and an
      // older one landing late hands back the newer value, not its own.
      if (inflight.get(key) === p) values.set(key, value);
      return values.has(key) ? (values.get(key) as T) : value;
    })
    .finally(() => {
      if (inflight.get(key) === p) inflight.delete(key);
    });
  inflight.set(key, p);
  return p;
}

/**
 * One backend read for a component. `key` null holds the read (still
 * loading) until what it depends on is known.
 *
 *  - Nothing cached for `key`: `loading` until the read lands.
 *  - Something cached: drawn at once, `loading` false, and re-read quietly —
 *    the rows update in place rather than blink.
 *  - `refresh()` re-reads in place, with no loading state.
 *
 * Responses that land after the key has moved on are dropped, so a slow read
 * for the last filter never overwrites the current one.
 */
export function useCachedResource<T>(
  key: string | null,
  fetcher: () => Promise<T>,
): {
  data: T | null;
  loading: boolean;
  error: Error | null;
  refresh: () => Promise<void>;
} {
  const [state, setState] = useState<{ key: string | null; data: T | null; error: Error | null }>(() => ({
    key,
    data: key === null ? null : (cachedValue<T>(key) ?? null),
    error: null,
  }));
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const keyRef = useRef(key);
  keyRef.current = key;

  // A new key draws what is cached for it straight away (during render, so no
  // frame shows the previous key's rows under the new filter), and otherwise
  // keeps the old rows up behind the loading state.
  let current = state;
  if (state.key !== key) {
    const known = key !== null && values.has(key);
    current = { key, data: known ? (cachedValue<T>(key) as T) : state.data, error: null };
    setState(current);
  }

  useEffect(() => {
    if (key === null) return;
    let cancelled = false;
    fetchCached(key, () => fetcherRef.current()).then(
      (data) => {
        if (!cancelled) setState({ key, data, error: null });
      },
      (err: unknown) => {
        if (!cancelled) setState((s) => (s.key === key ? { ...s, error: err as Error } : s));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [key]);

  const refresh = useCallback(async () => {
    const k = keyRef.current;
    if (k === null) return;
    try {
      const data = await fetchCached(k, () => fetcherRef.current(), true);
      setState((s) => (s.key === k ? { key: k, data, error: null } : s));
    } catch {
      // The rows keep what they showed; the next action re-checks with the server.
    }
  }, []);

  const hasValue = key !== null && values.has(key);
  const loading = key === null || (!hasValue && current.error === null);
  return { data: current.data, loading, error: current.error, refresh };
}
