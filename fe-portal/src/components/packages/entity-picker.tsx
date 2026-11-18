"use client";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button, Input, Label, Select } from "@/components/ui";
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

const NEW_ENTITY = "__new__";

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
  const [naming, setNaming] = useState(false);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);

  const options: { id: string; label: string }[] = entities.map((e) => ({ id: e.id, label: e.name }));
  for (const e of made) if (!options.some((o) => o.id === e.id)) options.push({ id: e.id, label: e.name });
  // The Entity the package is in now may be archived, so not in the live list: keep it choosable, said plainly.
  if (saved && !options.some((o) => o.id === saved.id)) {
    options.unshift({ id: saved.id, label: `${saved.name ?? "Current entity"} (archived)` });
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

  async function createEntity() {
    const name = newName.trim();
    if (!api || !name || creating) return;
    setCreating(true);
    try {
      const row = await api.post<ApiEntity>("/portal/admin/entities", { name });
      setMade((prev) => [...prev, entityFromApi(row)]);
      onChange(row.id);
      setNaming(false);
      setNewName("");
      // Other lists of Entities (the packages page's filter) read again.
      reload();
    } catch (err) {
      toast.error(entityRefusal(err, "Couldn't create the entity."));
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="space-y-1.5">
      <Label htmlFor="pkg-entity">Entity</Label>
      <Select
        id="pkg-entity"
        required
        value={naming ? NEW_ENTITY : value}
        onChange={(e) => {
          if (e.target.value === NEW_ENTITY) setNaming(true);
          else {
            setNaming(false);
            onChange(e.target.value);
          }
        }}
        disabled={status === "loading" && options.length === 0}
      >
        {!value && <option value="">{status === "loading" ? "Loading…" : "Choose an entity"}</option>}
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
        <option value={NEW_ENTITY}>+ New entity</option>
      </Select>

      {status === "failed" && options.length === 0 && (
        <p className="text-xs text-error">Couldn&apos;t load the studio&apos;s entities. Close this and try again.</p>
      )}

      {naming && (
        <div className="flex gap-2">
          <Input
            aria-label="New entity name"
            autoFocus
            maxLength={80}
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            // Enter names the Entity, not submits the package form around it.
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void createEntity();
              }
            }}
            placeholder="e.g. Pilates"
          />
          <Button type="button" onClick={() => void createEntity()} disabled={!newName.trim() || creating}>
            {creating ? "Creating…" : "Create"}
          </Button>
          <Button type="button" variant="ghost" onClick={() => setNaming(false)}>
            Cancel
          </Button>
        </div>
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
