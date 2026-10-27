"use client";
import { useEffect, useRef } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useWorkspace } from "@/lib/workspace-context";
import { locationParam, requestParam, withoutParams } from "@/lib/attention";

/**
 * Renders nothing. When the address names `?location=<id>` and that is one of
 * the caller's own locations, the active workspace switches to it and the param
 * is dropped, so a link from the bell lands on the right location's data. An id
 * that isn't theirs is dropped without switching. Mount it once per shell,
 * inside a `<Suspense>` (it reads the search params).
 */
export function LocationParamSync() {
  const { loading, accessibleLocations, setActiveLocationId } = useWorkspace();
  const search = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const ids = accessibleLocations.map((l) => l.id);

  useEffect(() => {
    if (loading || ids.length === 0) return;
    const query = `?${search.toString()}`;
    if (!search.has("location")) return;
    const target = locationParam(query, ids);
    if (target) setActiveLocationId(target);
    router.replace(`${pathname}${withoutParams(query, ["location"])}`, { scroll: false });
    // `ids` is rebuilt every render; its content is what matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, ids.join(","), search, pathname, router, setActiveLocationId]);

  return null;
}

/**
 * Open the item `?request=<id>` names, once the page's list has loaded. The
 * param is dropped once the item is found, so closing it and following the same
 * link again opens it again. An id that isn't in the list leaves the page as it
 * is. The page calls this inside a `<Suspense>`.
 */
export function useRequestDeepLink<T extends { id: string }>(
  items: readonly T[],
  loading: boolean,
  open: (item: T) => void,
) {
  const search = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const wanted = requestParam(`?${search.toString()}`);
  const openRef = useRef(open);
  useEffect(() => {
    openRef.current = open;
  });

  useEffect(() => {
    if (loading || !wanted) return;
    const item = items.find((i) => i.id === wanted);
    if (!item) return;
    openRef.current(item);
    router.replace(`${pathname}${withoutParams(`?${search.toString()}`, ["request"])}`, { scroll: false });
  }, [loading, wanted, items, pathname, router, search]);
}
