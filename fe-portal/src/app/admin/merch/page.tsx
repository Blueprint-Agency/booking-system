"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Plus, Archive, RotateCcw, ShoppingBag, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  Button,
  Dialog,
  DialogFooter,
  PageHeader,
  Badge,
  EmptyState,
  Input,
  Label,
  Textarea,
} from "@/components/ui";
import { useWorkspace } from "@/lib/workspace-context";
import { ApiError } from "@/lib/api";

interface Merch {
  id: string;
  title: string;
  description: string | null;
  price_sgd: string;
  image_url: string | null;
  archived_at: string | null;
}

function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError) {
    const body = err.body as { error?: string; message?: string } | null;
    return body?.message ?? body?.error ?? `${fallback} (HTTP ${err.status}).`;
  }
  return `${fallback}.`;
}

export default function MerchPage() {
  const { api } = useWorkspace();
  const [items, setItems] = useState<Merch[] | null>(null);
  const [editing, setEditing] = useState<Merch | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    if (!api) return;
    try {
      const res = await api.get<{ merch: Merch[] }>("/portal/admin/merch", {
        include_archived: "true",
      });
      setItems(res.merch);
    } catch (err) {
      toast.error(errorMessage(err, "Couldn't load merch"));
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  async function toggleArchive(item: Merch) {
    if (!api) return;
    try {
      await api.patch(`/portal/admin/merch/${item.id}`, { archived: !item.archived_at });
      await load();
      toast.success(item.archived_at ? "Item restored." : "Item archived.");
    } catch (err) {
      toast.error(errorMessage(err, "Archive failed"));
    }
  }

  async function handleDelete(item: Merch) {
    if (!api) return;
    if (!window.confirm(`Delete “${item.title}”? This cannot be undone.`)) return;
    try {
      await api.del(`/portal/admin/merch/${item.id}`);
      await load();
      toast.success("Item deleted.");
    } catch (err) {
      toast.error(errorMessage(err, "Delete failed"));
    }
  }

  const active = items?.filter((m) => !m.archived_at) ?? [];
  const archived = items?.filter((m) => m.archived_at) ?? [];

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="Merch"
        description="Studio goods shown in the customer app. Items are paid for and collected in person — the customer app says so at the top of the page."
        actions={
          <Button onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" /> Add item
          </Button>
        }
      />

      {items && active.length + archived.length === 0 ? (
        <EmptyState
          title="No merch yet"
          description="Add mats, props or apparel and they show up in the customer app."
          cta={
            <Button onClick={() => setCreating(true)}>
              <Plus className="h-4 w-4" /> Add item
            </Button>
          }
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {[...active, ...archived].map((item) => (
            <MerchCard
              key={item.id}
              item={item}
              onEdit={() => setEditing(item)}
              onArchive={() => toggleArchive(item)}
              onDelete={() => handleDelete(item)}
            />
          ))}
        </div>
      )}

      {(creating || editing) && (
        <MerchFormDialog
          item={editing}
          onDone={async () => {
            setCreating(false);
            setEditing(null);
            await load();
          }}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

function MerchCard({
  item,
  onEdit,
  onArchive,
  onDelete,
}: {
  item: Merch;
  onEdit: () => void;
  onArchive: () => void;
  onDelete: () => void;
}) {
  const isArchived = !!item.archived_at;
  return (
    <div
      className={`flex gap-4 rounded-xl border bg-card p-4 shadow-soft transition ${
        isArchived ? "border-border opacity-70" : "border-border hover:border-accent/40"
      }`}
    >
      <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-paper">
        {item.image_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={item.image_url} alt={item.title} className="h-full w-full object-cover" />
        ) : (
          <ShoppingBag className="h-5 w-5 text-muted" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="truncate text-base font-semibold text-ink">{item.title}</h3>
            <p className="text-sm text-muted">S${item.price_sgd}</p>
            {isArchived && (
              <Badge tone="neutral" className="mt-1">
                Archived
              </Badge>
            )}
          </div>
        </div>
        {item.description && (
          <p className="mt-1 line-clamp-2 text-xs text-muted">{item.description}</p>
        )}
        <div className="mt-2 flex gap-1">
          <Button size="sm" variant="ghost" onClick={onEdit}>
            Edit
          </Button>
          <Button size="sm" variant="ghost" onClick={onArchive}>
            {isArchived ? (
              <>
                <RotateCcw className="h-3.5 w-3.5" /> Restore
              </>
            ) : (
              <>
                <Archive className="h-3.5 w-3.5" /> Archive
              </>
            )}
          </Button>
          <Button size="sm" variant="ghost" onClick={onDelete}>
            <Trash2 className="h-3.5 w-3.5" /> Delete
          </Button>
        </div>
      </div>
    </div>
  );
}

function MerchFormDialog({
  item,
  onDone,
  onClose,
}: {
  item: Merch | null;
  onDone: () => void | Promise<void>;
  onClose: () => void;
}) {
  const { api } = useWorkspace();
  const [title, setTitle] = useState(item?.title ?? "");
  const [description, setDescription] = useState(item?.description ?? "");
  const [price, setPrice] = useState(item?.price_sgd ?? "");
  const [saving, setSaving] = useState(false);
  const imageInput = useRef<HTMLInputElement>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!api) return;
    setSaving(true);
    const body = {
      title: title.trim(),
      description: description.trim() || null,
      price_sgd: price,
    };
    try {
      const saved = item
        ? await api.patch<Merch>(`/portal/admin/merch/${item.id}`, body)
        : await api.post<Merch>("/portal/admin/merch", body);

      // The photo is its own call, so a file that is refused (wrong type, too
      // big) never costs the item that was already saved.
      const file = imageInput.current?.files?.[0];
      if (file) {
        const form = new FormData();
        form.append("file", file);
        try {
          await api.post(`/portal/admin/merch/${saved.id}/image`, form);
        } catch (err) {
          toast.error(errorMessage(err, "Item saved, but the photo didn't upload"));
          await onDone();
          return;
        }
      }
      toast.success(item ? "Item updated." : "Item created.");
      await onDone();
    } catch (err) {
      toast.error(errorMessage(err, "Save failed"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={item ? "Edit item" : "Add item"}>
      <form className="space-y-4" onSubmit={handleSubmit}>
        <div className="space-y-1.5">
          <Label htmlFor="merch-title">Title</Label>
          <Input
            id="merch-title"
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="merch-description">Description</Label>
          <Textarea
            id="merch-description"
            rows={4}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="merch-price">Price (SGD)</Label>
          <Input
            id="merch-price"
            required
            type="number"
            min="0"
            step="0.01"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="merch-image">Photo</Label>
          <Input
            id="merch-image"
            ref={imageInput}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="h-auto py-2 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-warm file:px-2.5 file:py-1 file:text-xs file:text-ink"
          />
          <p className="text-xs text-muted">
            JPG, PNG or WebP, up to 5MB.{" "}
            {item?.image_url ? "Uploading replaces the current photo." : ""}
          </p>
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={saving}>
            {saving ? "Saving…" : item ? "Save changes" : "Create"}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
