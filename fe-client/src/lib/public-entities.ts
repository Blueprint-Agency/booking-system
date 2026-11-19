"use client";

import { publicApi } from "./api";
import { useCachedResource } from "./resource-cache";
import { packageEntities, resolveEntity, showEntityDropdown, type PublicEntity } from "./entities";

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

/**
 * Which Entity a Packages page is on, from the slug in its URL (none on
 * `/packages`):
 *
 *  - `entity`: the Entity slug to read packages for. A string when the studio
 *    offers two or more Entities with packages (the slug resolved, falling back
 *    to the first); `null` otherwise, so a studio with one Entity, or whose
 *    Entities cannot be read, gets today's page with every package; `undefined`
 *    while the Entities are still loading, so no read goes out for a guess.
 *  - `entities`: the Entities to offer in the switcher, or null for no switcher.
 */
export function usePackagesEntity(slug: string | null | undefined): {
  entity: string | null | undefined;
  entities: PublicEntity[] | null;
} {
  const { data, loading } = usePublicEntities();
  if (loading) return { entity: undefined, entities: null };
  if (!data || !showEntityDropdown(data)) return { entity: null, entities: null };
  return { entity: resolveEntity(slug, data)?.slug ?? null, entities: packageEntities(data) };
}
