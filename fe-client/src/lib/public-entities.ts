"use client";

import { publicApi } from "./api";
import { useCachedResource } from "./resource-cache";
import type { PublicEntity } from "./entities";

const getEntities = async () => {
  const res = await publicApi.get<{ entities: PublicEntity[] }>("/public/entities");
  return res.entities;
};

/**
 * The studio's live Entities in its order. Barely changes within a visit, so it
 * is read once and shared (`resource-cache.ts`). `optional`: a studio whose list
 * cannot be read still gets its schedule, just without Entity buttons.
 * `data` is null while it loads, and after a failed read; `loading` tells them apart.
 */
export function usePublicEntities(): { data: PublicEntity[] | null; loading: boolean } {
  const { data, loading } = useCachedResource("public:entities", getEntities, { optional: true });
  return { data, loading };
}
