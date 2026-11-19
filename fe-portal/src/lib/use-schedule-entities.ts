"use client";
import { useEffect, useState } from "react";
import { useWorkspace } from "@/lib/workspace-context";
import { ENTITIES_PATH, scheduleEntities, type EntityChoice } from "@/lib/schedule-entity-filter";

/**
 * The studio's live Entities for a schedule's filter. A read that fails (or a
 * backend from before Entities, which has no such route) leaves none, and with
 * fewer than two the filter is not shown: the schedule is then as it was.
 */
export function useScheduleEntities(source: keyof typeof ENTITIES_PATH): EntityChoice[] {
  const { api } = useWorkspace();
  const [entities, setEntities] = useState<EntityChoice[]>([]);

  useEffect(() => {
    if (!api) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await api.get<Parameters<typeof scheduleEntities>[0]>(ENTITIES_PATH[source]);
        if (!cancelled) setEntities(scheduleEntities(res));
      } catch {
        if (!cancelled) setEntities([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [api, source]);

  return entities;
}
