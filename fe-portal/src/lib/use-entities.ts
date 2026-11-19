"use client";
import { entityFromApi, type ApiEntity, type Entity } from "@/lib/entities";
import { useRead } from "@/lib/use-read";

/**
 * The studio's live Entities, in display order. Read fresh each time a screen
 * mounts (never through the module catalog cache, which would show a stale
 * list after "+ New entity"); `reload` reads again after one is made.
 *
 * `status` says whether the list is the answer yet: a failed read is `failed`,
 * never an empty list, which would read as a studio with no Entities.
 */
export function useEntities(): { entities: Entity[]; status: "loading" | "loaded" | "failed"; reload: () => void } {
  const { read, retry } = useRead<Entity[]>(
    "package-entities",
    async (api) => (await api.get<{ entities: ApiEntity[] }>("/portal/admin/entities")).entities.map(entityFromApi),
    { scope: "entities" },
  );
  return {
    entities: read.status === "loaded" ? read.data : [],
    status: read.status === "loaded" ? "loaded" : read.status === "failed" ? "failed" : "loading",
    reload: retry,
  };
}
