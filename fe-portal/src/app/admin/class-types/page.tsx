"use client";
import { Fragment, useCallback, useEffect, useState } from "react";
import { Plus, Archive, RotateCcw, Pencil, Loader2, CornerDownRight } from "lucide-react";
import { toast } from "sonner";
import {
  Button,
  PageHeader,
  Badge,
  EmptyState,
  Dialog,
  DialogFooter,
  Input,
  Label,
  Textarea,
} from "@/components/ui";
import { useWorkspace } from "@/lib/workspace-context";
import { ApiError } from "@/lib/api";
import type { ClassType } from "@/types";

interface ApiClassType {
  id: string;
  name: string;
  description: string | null;
  parent_id: string | null;
  archived_at: string | null;
}

function fromApi(r: ApiClassType): ClassType {
  return {
    id: r.id,
    name: r.name,
    description: r.description ?? "",
    parentId: r.parent_id,
    archivedAt: r.archived_at,
  };
}

export default function ClassTypesPage() {
  const { api } = useWorkspace();
  const [classTypes, setClassTypes] = useState<ClassType[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<{ kind: "create" } | { kind: "edit"; ct: ClassType } | null>(
    null,
  );

  const reload = useCallback(async () => {
    if (!api) return;
    setLoading(true);
    setError(null);
    try {
      const data = await api.get<{ class_types: ApiClassType[] }>(
        "/portal/admin/class-types",
        { include_archived: "true" },
      );
      setClassTypes(data.class_types.map(fromApi));
    } catch (err) {
      setError(err instanceof ApiError ? `HTTP ${err.status}` : "Network error");
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const active = classTypes.filter((c) => !c.archivedAt);
  const archived = classTypes.filter((c) => c.archivedAt);

  // Only root-only (parentId === null) active rows are eligible as parents.
  // Per spec: depth capped at 1. A row already being a child can't become a parent.
  const parentCandidates = (excludeId?: string | null) =>
    active.filter((c) => c.parentId === null && c.id !== excludeId);

  async function handleSave(ct: ClassType) {
    if (!api) return;
    try {
      const exists = classTypes.some((c) => c.id === ct.id);
      const body = {
        name: ct.name,
        description: ct.description?.trim() ? ct.description.trim() : null,
        parent_id: ct.parentId,
      };
      if (exists) {
        await api.patch(`/portal/admin/class-types/${ct.id}`, body);
      } else {
        await api.post("/portal/admin/class-types", body);
      }
      setDialog(null);
      await reload();
      toast.success("Class type saved.");
    } catch (err) {
      if (err instanceof ApiError) {
        const body = err.body as { error?: string } | null;
        const code = body?.error ?? "";
        if (code === "parent_must_be_root") {
          toast.error("That parent is itself a child — only top-level class types can be parents.");
          return;
        }
        if (code === "class_type_has_children") {
          toast.error("This class type has children — remove or reparent them before turning it into a child.");
          return;
        }
        if (code === "parent_self_reference") {
          toast.error("A class type can't be its own parent.");
          return;
        }
        toast.error(`Save failed (HTTP ${err.status}).`);
      } else {
        toast.error("Save failed.");
      }
    }
  }

  async function toggleArchive(ct: ClassType) {
    if (!api) return;
    try {
      if (ct.archivedAt) {
        await api.post(`/portal/admin/class-types/${ct.id}/unarchive`);
        await reload();
        toast.success("Class type restored.");
        return;
      }
      await api.post(`/portal/admin/class-types/${ct.id}/archive`);
      await reload();
      toast.success("Class type archived.");
    } catch (err) {
      if (err instanceof ApiError) {
        const body = err.body as { error?: string } | null;
        if (body?.error === "class_type_in_use") {
          toast.error("In use — assigned to active classes, workshops, or instructors. Reassign first.");
          return;
        }
        toast.error(`Archive failed (HTTP ${err.status}).`);
      } else {
        toast.error("Archive failed.");
      }
    }
  }

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Class Types"
        description="Shared catalogue used by class instances, workshops, and instructor eligibility. Single-level hierarchy: a type may have a parent, but a child cannot itself become a parent."
        actions={
          <Button onClick={() => setDialog({ kind: "create" })}>
            <Plus className="h-4 w-4" /> Add class type
          </Button>
        }
      />

      {loading ? (
        <SkeletonList />
      ) : error ? (
        <ErrorBlock message={error} onRetry={reload} />
      ) : classTypes.length === 0 ? (
        <EmptyState title="No class types yet" description="Add your first class type to start scheduling." />
      ) : (
        <Tree
          all={active}
          onEdit={(ct) => setDialog({ kind: "edit", ct })}
          onArchive={(ct) => toggleArchive(ct)}
        />
      )}

      {archived.length > 0 && (
        <>
          <h2 className="mb-3 mt-10 text-xs font-semibold uppercase tracking-wider text-muted">
            Archived
          </h2>
          <Tree
            all={archived}
            onEdit={(ct) => setDialog({ kind: "edit", ct })}
            onArchive={(ct) => toggleArchive(ct)}
            dimmed
          />
        </>
      )}

      {dialog && (
        <ClassTypeDialog
          ct={dialog.kind === "edit" ? dialog.ct : null}
          parents={parentCandidates(dialog.kind === "edit" ? dialog.ct.id : undefined)}
          onSave={handleSave}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  );
}

function SkeletonList() {
  return (
    <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card shadow-soft">
      {Array.from({ length: 4 }).map((_, i) => (
        <li key={i} className="flex items-center gap-3 px-4 py-3">
          <div className="h-4 w-32 animate-pulse rounded bg-paper" />
          <div className="h-3 w-20 animate-pulse rounded bg-paper" />
        </li>
      ))}
    </ul>
  );
}

function ErrorBlock({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="rounded-xl border border-error/30 bg-error/5 px-4 py-6 text-center">
      <p className="text-sm text-error">Failed to load: {message}</p>
      <Button size="sm" variant="ghost" onClick={onRetry} className="mt-2">
        <Loader2 className="h-3.5 w-3.5" /> Retry
      </Button>
    </div>
  );
}

function Tree({
  all,
  onEdit,
  onArchive,
  dimmed,
}: {
  all: ClassType[];
  onEdit: (ct: ClassType) => void;
  onArchive: (ct: ClassType) => void;
  dimmed?: boolean;
}) {
  // Group by parent. Roots = parentId === null. Children grouped under their parent.
  // Orphans (parentId points to something not in `all`, e.g. archived parent) render
  // at root level so they're still visible/editable.
  const roots = all.filter((c) => c.parentId === null);
  const byParent = new Map<string, ClassType[]>();
  for (const c of all) {
    if (c.parentId) {
      const list = byParent.get(c.parentId) ?? [];
      list.push(c);
      byParent.set(c.parentId, list);
    }
  }
  const orphans = all.filter(
    (c) => c.parentId && !all.some((p) => p.id === c.parentId),
  );

  return (
    <ul
      className={`divide-y divide-border overflow-hidden rounded-xl border border-border bg-card shadow-soft ${
        dimmed ? "opacity-70" : ""
      }`}
    >
      {[...roots, ...orphans].map((ct) => {
        const children = byParent.get(ct.id) ?? [];
        return (
          <Fragment key={ct.id}>
            <ClassTypeRow ct={ct} onEdit={() => onEdit(ct)} onArchive={() => onArchive(ct)} />
            {children.map((child) => (
              <ClassTypeRow
                key={child.id}
                ct={child}
                onEdit={() => onEdit(child)}
                onArchive={() => onArchive(child)}
                indent
              />
            ))}
          </Fragment>
        );
      })}
    </ul>
  );
}

function ClassTypeRow({
  ct,
  onEdit,
  onArchive,
  indent,
}: {
  ct: ClassType;
  onEdit: () => void;
  onArchive: () => void;
  indent?: boolean;
}) {
  const isArchived = !!ct.archivedAt;
  return (
    <li className={`flex items-center justify-between gap-3 px-4 py-3 ${indent ? "pl-10" : ""}`}>
      <div className="flex min-w-0 flex-1 items-start gap-2">
        {indent && <CornerDownRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted" />}
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-ink">{ct.name}</span>
            {isArchived && <Badge tone="neutral">Archived</Badge>}
          </div>
          {ct.description && (
            <div className="mt-0.5 text-xs text-muted">{ct.description}</div>
          )}
        </div>
      </div>
      <div className="flex shrink-0 gap-1">
        <Button size="sm" variant="ghost" onClick={onEdit}>
          <Pencil className="h-3.5 w-3.5" /> Edit
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
      </div>
    </li>
  );
}

function ClassTypeDialog({
  ct,
  parents,
  onSave,
  onClose,
}: {
  ct: ClassType | null;
  parents: ClassType[];
  onSave: (ct: ClassType) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(ct?.name ?? "");
  const [description, setDescription] = useState(ct?.description ?? "");
  const [parentId, setParentId] = useState<string | "">(ct?.parentId ?? "");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    onSave({
      id: ct?.id ?? `ct-${Date.now().toString(36)}`,
      name: name.trim(),
      description: description.trim(),
      parentId: parentId === "" ? null : parentId,
      archivedAt: ct?.archivedAt ?? null,
    });
  }

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={ct ? "Edit class type" : "Add class type"}
    >
      <form className="space-y-4" onSubmit={handleSubmit}>
        <div className="space-y-1.5">
          <Label htmlFor="ct-name">Name</Label>
          <Input
            id="ct-name"
            required
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Vinyasa Flow, Aerial Yoga"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="ct-description">Description</Label>
          <Textarea
            id="ct-description"
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Short blurb shown to clients on /classes and workshop cards."
          />
          <p className="text-xs text-muted">Optional. Up to ~500 characters.</p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="ct-parent">Parent class</Label>
          <select
            id="ct-parent"
            value={parentId}
            onChange={(e) => setParentId(e.target.value)}
            className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-accent"
          >
            <option value="">— None (top-level) —</option>
            {parents.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <p className="text-xs text-muted">
            Optional. Single-level hierarchy — only top-level types can be parents.
          </p>
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit">{ct ? "Save" : "Create"}</Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
