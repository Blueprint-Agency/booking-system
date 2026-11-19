"use client";
import { readEntities, type EntitiesSource, type Entity } from "@/lib/entities";
import { useRead } from "@/lib/use-read";

/**
 * The studio's live Entities, in display order. Read fresh each time a screen
 * mounts (never through the module catalog cache, which would show a stale
 * list after "+ New entity"); `reload` reads again after one is made.
 * An Instructor's screen passes "instructor", which reads the catalog route an
 * Instructor may call; everything else reads the Admin's list.
 *
 * `status` says whether the list is the answer yet: a failed read is `failed`,
 * never an empty list, which would read as a studio with no Entities.
 */
export function useEntities(
  source: EntitiesSource = "admin",
): { entities: Entity[]; status: "loading" | "loaded" | "failed"; reload: () => void } {
  const { read, retry } = useRead<Entity[]>(`entities-${source}`, (api) => readEntities(api, source), {
    scope: "entities",
  });
  return {
    entities: read.status === "loaded" ? read.data : [],
    status: read.status === "loaded" ? "loaded" : read.status === "failed" ? "failed" : "loading",
    reload: retry,
  };
}
