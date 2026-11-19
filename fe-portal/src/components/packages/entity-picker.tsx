"use client";
import { useEffect, useState } from "react";
import { Label } from "@/components/ui";
import { EntitySelect } from "@/components/entity-select";
import { useWorkspace } from "@/lib/workspace-context";
import { useEntities } from "@/lib/use-entities";
import {
  defaultEntityId,
  entityFromApi,
  entityRefusal,
  moveNotice,
  type ApiEntity,
  type Entity,
} from "@/lib/entities";

type Preview = { for: string; state: "loaded"; members: number } | { for: string; state: "failed" };

/**
 * The Entity a package is sold under, on each package form (be-portal.md
 * § Package Entities). A required dropdown: it starts on the studio's first
 * Entity, and "+ New entity" makes one in place and selects it.
 *
 * Editing a package that sits in one Entity and is being moved to another reads
 * the move preview first, shows how many members hold the package ("it moves
 * with it"), and reports `onReady(false)` until it has, so the form's Save is
 * not offered before the admin has been told. `onReady` is also false while no
 * Entity is chosen (the list is still loading, or the studio has none).
 */
export function EntityPicker({
  value,
  onChange,
  saved,
  previewPath,
  onReady,
}: {
  value: string;
  onChange: (entityId: string) => void;
  /** The Entity the package is in now, when editing. Shown even if archived. */
  saved?: { id: string; name: string | null } | null;
  /** `GET` path of the package's move preview, without its query. Set when editing. */
  previewPath?: string;
  onReady: (ready: boolean) => void;
}) {
  const { api } = useWorkspace();
  const { entities, status, reload } = useEntities();
  // Entities made from this form, shown at once without waiting for the list to be read again.
  const [made, setMade] = useState<Entity[]>([]);
  const [preview, setPreview] = useState<Preview | null>(null);

  const options: { id: string; name: string }[] = entities.map((e) => ({ id: e.id, name: e.name }));
  for (const e of made) if (!options.some((o) => o.id === e.id)) options.push({ id: e.id, name: e.name });
  // The Entity the package is in now may be archived, so not in the live list: keep it choosable, said plainly.
  if (saved && !options.some((o) => o.id === saved.id)) {
    options.unshift({ id: saved.id, name: `${saved.name ?? "Current entity"} (archived)` });
  }

  // A new package starts in the studio's first Entity.
  useEffect(() => {
    if (!value && !saved && status === "loaded") {
      const first = defaultEntityId(entities);
      if (first) onChange(first);
    }
  }, [value, saved, status, entities, onChange]);

  const moving = Boolean(saved && previewPath && value && value !== saved.id);
  useEffect(() => {
    if (!moving || !api || !previewPath) return;
    let cancelled = false;
    // Until an answer for this Entity lands, `preview.for` is another one: that is "loading".
    api
      .get<{ members_holding: number }>(`${previewPath}?entity_id=${encodeURIComponent(value)}`)
      .then((r) => {
        if (!cancelled) setPreview({ for: value, state: "loaded", members: r.members_holding });
      })
      .catch(() => {
        if (!cancelled) setPreview({ for: value, state: "failed" });
      });
    return () => {
      cancelled = true;
    };
  }, [moving, api, previewPath, value]);

  const told = moving ? preview?.for === value && preview.state === "loaded" : true;
  const ready = Boolean(value) && told;
  useEffect(() => {
    onReady(ready);
  }, [ready, onReady]);

  async function createEntity(name: string): Promise<Entity> {
    if (!api) throw new Error("Not signed in.");
    try {
      const row = entityFromApi(await api.post<ApiEntity>("/portal/admin/entities", { name }));
      setMade((prev) => [...prev, row]);
      // Other lists of Entities (the packages page's filter) read again.
      reload();
      return row;
    } catch (err) {
      throw new Error(entityRefusal(err, "Couldn't create the entity."));
    }
  }

  return (
    <div className="space-y-1.5">
      <Label htmlFor="pkg-entity">Entity</Label>
      <EntitySelect
        id="pkg-entity"
        entities={options}
        value={value}
        onChange={onChange}
        onCreate={createEntity}
        placeholder={status === "loading" ? "Loading…" : "Choose an entity"}
        disabled={status === "loading" && options.length === 0}
      />

      {status === "failed" && options.length === 0 && (
        <p className="text-xs text-error">Couldn&apos;t load the studio&apos;s entities. Close this and try again.</p>
      )}

      {moving && preview?.for !== value && (
        <p className="text-xs text-muted">Checking who holds this package…</p>
      )}
      {moving && preview?.for === value && preview.state === "loaded" && (
        <p className="rounded-lg bg-warning/10 px-3 py-2 text-xs text-ink">{moveNotice(preview.members)}</p>
      )}
      {moving && preview?.for === value && preview.state === "failed" && (
        <p className="text-xs text-error">
          Couldn&apos;t check who holds this package, so it can&apos;t be moved yet. Pick a different entity, or close this and try again.
        </p>
      )}
    </div>
  );
}
