"use client";
import { Fragment, useMemo, useState } from "react";
import { Plus, Archive, RotateCcw, Pencil } from "lucide-react";
import {
  Button,
  PageHeader,
  Badge,
  EmptyState,
  Dialog,
  DialogFooter,
  Input,
  Label,
} from "@/components/ui";
import { classTypes as seedClassTypes } from "@/data";
import type { ClassType } from "@/types";

export default function ClassTypesPage() {
  const [classTypes, setClassTypes] = useState<ClassType[]>(seedClassTypes);
  const [dialog, setDialog] = useState<{ kind: "create" } | { kind: "edit"; ct: ClassType } | null>(
    null
  );

  const active = classTypes.filter((c) => !c.archivedAt);
  const archived = classTypes.filter((c) => c.archivedAt);

  function handleSave(ct: ClassType) {
    setClassTypes((prev) =>
      prev.some((c) => c.id === ct.id) ? prev.map((c) => (c.id === ct.id ? ct : c)) : [...prev, ct]
    );
    setDialog(null);
  }

  function toggleArchive(id: string) {
    setClassTypes((prev) =>
      prev.map((c) =>
        c.id === id ? { ...c, archivedAt: c.archivedAt ? null : new Date().toISOString() } : c
      )
    );
  }

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Class Types"
        description="Shared catalogue used by class instances, workshops, and instructor eligibility."
        actions={
          <Button onClick={() => setDialog({ kind: "create" })}>
            <Plus className="h-4 w-4" /> Add class type
          </Button>
        }
      />

      {classTypes.length === 0 ? (
        <EmptyState title="No class types yet" description="Add your first class type to start scheduling." />
      ) : (
        <Tree
          all={active}
          onEdit={(ct) => setDialog({ kind: "edit", ct })}
          onArchive={(id) => toggleArchive(id)}
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
            onArchive={(id) => toggleArchive(id)}
            dimmed
          />
        </>
      )}

      {dialog && (
        <ClassTypeDialog
          ct={dialog.kind === "edit" ? dialog.ct : null}
          all={classTypes}
          onSave={handleSave}
          onClose={() => setDialog(null)}
        />
      )}
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
  onArchive: (id: string) => void;
  dimmed?: boolean;
}) {
  const topLevel = all.filter((c) => c.parentId === null);
  const childrenOf = (pid: string) => all.filter((c) => c.parentId === pid);
  return (
    <ul
      className={`divide-y divide-border overflow-hidden rounded-xl border border-border bg-card shadow-soft ${
        dimmed ? "opacity-70" : ""
      }`}
    >
      {topLevel.map((ct) => (
        <Fragment key={ct.id}>
          <ClassTypeRow ct={ct} onEdit={() => onEdit(ct)} onArchive={() => onArchive(ct.id)} />
          {childrenOf(ct.id).map((child) => (
            <ClassTypeRow
              key={child.id}
              ct={child}
              onEdit={() => onEdit(child)}
              onArchive={() => onArchive(child.id)}
              indent
            />
          ))}
        </Fragment>
      ))}
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
    <li
      className={`flex items-center justify-between gap-3 py-3 ${
        indent ? "pl-10 pr-4 border-l-2 border-border ml-4" : "px-4"
      }`}
    >
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-ink">{ct.name}</span>
        {isArchived && <Badge tone="neutral">Archived</Badge>}
        {ct.description && (
          <span
            className="hidden truncate text-xs text-muted sm:inline-block sm:max-w-[40ch]"
            title={ct.description}
          >
            {ct.description}
          </span>
        )}
      </div>
      <div className="flex shrink-0 gap-1">
        {!isArchived && (
          <Button size="sm" variant="ghost" onClick={onEdit}>
            <Pencil className="h-3.5 w-3.5" /> Edit
          </Button>
        )}
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
  all,
  onSave,
  onClose,
}: {
  ct: ClassType | null;
  all: ClassType[];
  onSave: (ct: ClassType) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(ct?.name ?? "");
  const [description, setDescription] = useState(ct?.description ?? "");
  const [parentId, setParentId] = useState<string | null>(ct?.parentId ?? null);

  const parentOptions = useMemo(
    () => all.filter((c) => !c.archivedAt && c.parentId === null && c.id !== ct?.id),
    [all, ct?.id]
  );

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    onSave({
      id: ct?.id ?? `ct-${Date.now().toString(36)}`,
      name: name.trim(),
      description: description.trim(),
      parentId,
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
          <Label htmlFor="ct-desc">Description (optional)</Label>
          <textarea
            id="ct-desc"
            rows={3}
            maxLength={200}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Short description shown to clients."
            className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="ct-parent">Parent (optional)</Label>
          <select
            id="ct-parent"
            value={parentId ?? ""}
            onChange={(e) => setParentId(e.target.value || null)}
            className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm"
          >
            <option value="">Top-level (no parent)</option>
            {parentOptions.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
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
