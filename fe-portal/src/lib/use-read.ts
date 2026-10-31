"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Api } from "@/lib/api";
import { reportError } from "@/lib/report-error";
import { useWorkspace } from "@/lib/workspace-context";
import { afterFailedRead, readLoaded, READ_LOADING, type ReadState } from "@/lib/failed-read";

/**
 * One read of the backend, held as loading, loaded or failed
 * (`lib/failed-read.ts`). Reads again when `key` changes (name everything the
 * request depends on in it) and when `retry` is called. Only the newest request
 * may land, so a slow answer for a filter just left cannot overwrite this one.
 * `enabled: false` leaves it loading, with no request.
 */
export function useRead<T>(
  key: string,
  load: (api: Api) => Promise<T>,
  { enabled = true, scope = "portal-read" }: { enabled?: boolean; scope?: string } = {},
): { read: ReadState<T>; retry: () => void } {
  const { api } = useWorkspace();
  const [read, setRead] = useState<ReadState<T>>(READ_LOADING);
  const [attempt, setAttempt] = useState(0);
  const loadRef = useRef(load);
  useEffect(() => {
    loadRef.current = load;
  });

  useEffect(() => {
    if (!api || !enabled) return;
    let cancelled = false;
    setRead(READ_LOADING);
    loadRef
      .current(api)
      .then((data) => {
        if (!cancelled) setRead(readLoaded(data));
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        reportError(err, { scope });
        setRead(afterFailedRead<T>(err));
      });
    return () => {
      cancelled = true;
    };
  }, [api, enabled, key, attempt, scope]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return { read, retry };
}
