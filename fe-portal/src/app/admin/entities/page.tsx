"use client";
import { useState } from "react";
import { Archive, ArrowDown, ArrowUp, Pencil, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button, PageHeader, EmptyState, Dialog, DialogFooter, Input, Label } from "@/components/ui";
import { LoadFailure } from "@/components/ui/load-failure";
import { useWorkspace } from "@/lib/workspace-context";
import { useRead } from "@/lib/use-read";
import {
  entityFromApi,
  entityRefusal,
  moveInOrder,
  slugFromName,
  usageSentence,
  type ApiEntity,
  type Entity,
} from "@/lib/entities";

type DialogState = { kind: "create" } | { kind: "edit"; entity: Entity } | null;

export default function EntitiesPage() {
  const { api } = useWorkspace();
  // A failed read is said to have failed: never an empty list, which would read as "no entities".
  const { read, retry } = useRead<Entity[]>(
    "entities",
    async (client) =>
      (await client.get<{ entities: ApiEntity[] }>("/portal/admin/entities")).entities.map(entityFromApi),
    { scope: "entities" },
  );
  // The list a reorder answered with, shown until the next read replaces it.
  const [reordered, setReordered] = useState<Entity[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState<DialogState>(null);

  const loading = read.status === "loading";
  const failed = read.status === "failed";
  const entities: Entity[] = reordered ?? (read.status === "loaded" ? read.data : []);

  function reload() {
    setReordered(null);
    retry();
  }

  async function handleSave(input: { id: string | null; name: string; slug: string }) {
    if (!api) return;
    try {
      if (input.id) {
        const was = entities.find((e) => e.id === input.id);
        await api.patch(`/portal/admin/entities/${input.id}`, {
          ...(input.name !== was?.name ? { name: input.name } : {}),
          ...(input.slug !== was?.slug ? { slug: input.slug } : {}),
        });
      } else {
        await api.post("/portal/admin/entities", {
          name: input.name,
          ...(input.slug ? { slug: input.slug } : {}),
        });
      }
      setDialog(null);
      reload();
      toast.success("Entity saved.");
    } catch (err) {
      toast.error(entityRefusal(err, "Save failed."));
    }
  }

  async function move(index: number, direction: "up" | "down") {
    if (!api || busy) return;
    const ids = moveInOrder(
      entities.map((e) => e.id),
      index,
      direction,
    );
    setBusy(true);
    try {
      const data = await api.put<{ entities: ApiEntity[] }>("/portal/admin/entities/order", { ids });
      setReordered(data.entities.map(entityFromApi));
    } catch (err) {
      toast.error(entityRefusal(err, "Couldn't change the order."));
      reload();
    } finally {
      setBusy(false);
    }
  }

  async function archive(entity: Entity) {
    if (!api) return;
    const holding = usageSentence(entity.inUse);
    if (holding) {
      toast.error(`Still in use by ${holding}. Move them to another entity first.`);
      return;
    }
    if (!window.confirm(`Archive ${entity.name}? Members will no longer see it.`)) return;
    try {
      await api.post(`/portal/admin/entities/${entity.id}/archive`);
      reload();
      toast.success("Entity archived.");
    } catch (err) {
      toast.error(entityRefusal(err, "Archive failed."));
    }
  }

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Entities"
        description="The lines of practice your studio sells packages for, such as Yoga or Pilates. Members see them in this order. A studio with one entity looks no different to its members."
        actions={
          <Button onClick={() => setDialog({ kind: "create" })} disabled={loading || failed}>
            <Plus className="h-4 w-4" /> Add entity
          </Button>
        }
      />

      {loading ? (
        <ul className="mt-6 divide-y divide-border overflow-hidden rounded-xl border border-border bg-card shadow-soft">
          {Array.from({ length: 2 }).map((_, i) => (
            <li key={i} className="flex items-center gap-3 px-4 py-3">
              <div className="h-4 w-32 animate-pulse rounded bg-paper" />
            </li>
          ))}
        </ul>
      ) : failed ? (
        <LoadFailure what="the entities" onRetry={reload} className="mt-6 rounded-xl border border-border bg-card" />
      ) : entities.length === 0 ? (
        <EmptyState title="No entities" description="Add an entity to start." />
      ) : (
        <ul className="mt-6 divide-y divide-border overflow-hidden rounded-xl border border-border bg-card shadow-soft">
          {entities.map((entity, index) => (
            <li key={entity.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="break-words text-sm font-medium text-ink">{entity.name}</div>
                <div className="mt-0.5 text-xs text-muted">/{entity.slug}</div>
              </div>
              <div className="ml-auto flex shrink-0 flex-wrap justify-end gap-1">
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={`Move ${entity.name} up`}
                  disabled={busy || index === 0}
                  onClick={() => void move(index, "up")}
                >
                  <ArrowUp className="h-3.5 w-3.5" />
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={`Move ${entity.name} down`}
                  disabled={busy || index === entities.length - 1}
                  onClick={() => void move(index, "down")}
                >
                  <ArrowDown className="h-3.5 w-3.5" />
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setDialog({ kind: "edit", entity })}>
                  <Pencil className="h-3.5 w-3.5" /> Edit
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={entities.length === 1}
                  title={entities.length === 1 ? "A studio needs at least one entity." : undefined}
                  onClick={() => void archive(entity)}
                >
                  <Archive className="h-3.5 w-3.5" /> Archive
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {dialog && (
        <EntityDialog
          entity={dialog.kind === "edit" ? dialog.entity : null}
          onSave={handleSave}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  );
}

function EntityDialog({
  entity,
  onSave,
  onClose,
}: {
  entity: Entity | null;
  onSave: (input: { id: string | null; name: string; slug: string }) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(entity?.name ?? "");
  const [slug, setSlug] = useState(entity?.slug ?? "");
  const suggested = slugFromName(name);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    const address = slug.trim();
    if (!entity && !address && !suggested) {
      toast.error("Give it an address too: the name has no letters or numbers to make one from.");
      return;
    }
    onSave({ id: entity?.id ?? null, name: trimmed, slug: address });
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={entity ? "Edit entity" : "Add entity"}>
      <form className="space-y-4" onSubmit={handleSubmit}>
        <div className="space-y-1.5">
          <Label htmlFor="entity-name">Name</Label>
          <Input
            id="entity-name"
            required
            autoFocus
            maxLength={80}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Yoga, Pilates"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="entity-slug">Address</Label>
          <Input
            id="entity-slug"
            maxLength={60}
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            placeholder={suggested || "pilates"}
          />
          <p className="text-xs text-muted">
            {entity
              ? "Used in the member page's web address. Renaming an entity does not change it."
              : "Used in the member page's web address. Leave blank to use the one made from the name."}
          </p>
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit">{entity ? "Save" : "Create"}</Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
