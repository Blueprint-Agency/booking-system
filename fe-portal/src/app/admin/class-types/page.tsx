"use client";
import { useState } from "react";
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
        <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card shadow-soft">
          {active.map((ct) => (
            <ClassTypeRow
              key={ct.id}
              ct={ct}
              onEdit={() => setDialog({ kind: "edit", ct })}
              onArchive={() => toggleArchive(ct.id)}
            />
          ))}
        </ul>
      )}

      {archived.length > 0 && (
        <>
          <h2 className="mb-3 mt-10 text-xs font-semibold uppercase tracking-wider text-muted">
            Archived
          </h2>
          <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card opacity-70 shadow-soft">
            {archived.map((ct) => (
              <ClassTypeRow
                key={ct.id}
                ct={ct}
                onEdit={() => setDialog({ kind: "edit", ct })}
                onArchive={() => toggleArchive(ct.id)}
              />
            ))}
          </ul>
        </>
      )}

      {dialog && (
        <ClassTypeDialog
          ct={dialog.kind === "edit" ? dialog.ct : null}
          onSave={handleSave}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  );
}

function ClassTypeRow({
  ct,
  onEdit,
  onArchive,
}: {
  ct: ClassType;
  onEdit: () => void;
  onArchive: () => void;
}) {
  const isArchived = !!ct.archivedAt;
  return (
    <li className="flex items-center justify-between gap-3 px-4 py-3">
      <div className="flex items-center gap-3 min-w-0">
        <span className="text-sm font-medium text-ink">{ct.name}</span>
        {isArchived && <Badge tone="neutral">Archived</Badge>}
      </div>
      <div className="flex gap-1">
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
  onSave,
  onClose,
}: {
  ct: ClassType | null;
  onSave: (ct: ClassType) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(ct?.name ?? "");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    onSave({
      id: ct?.id ?? `ct-${Date.now().toString(36)}`,
      name: name.trim(),
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
