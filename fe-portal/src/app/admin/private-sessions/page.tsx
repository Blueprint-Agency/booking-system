"use client";
import { useState } from "react";
import { Plus, Pencil, Archive, RotateCcw, Save } from "lucide-react";
import { Button, PageHeader, Badge, EmptyState, Input, Label } from "@/components/ui";
import { ptPackages as seedPackages, ptBookingConfig as seedConfig } from "@/data";
import { PtPackageDialog } from "@/components/packages/pt-package-dialog";
import { formatSgd } from "@/lib/formatters";
import type { PtPackage, PtBookingConfig } from "@/types";

export default function PrivateSessionsPage() {
  const [packages, setPackages] = useState<PtPackage[]>(seedPackages);
  const [config, setConfig] = useState<PtBookingConfig>(seedConfig);
  const [draftAdvance, setDraftAdvance] = useState<number>(seedConfig.bookInAdvanceDays);
  const [dialog, setDialog] = useState<
    { kind: "create" } | { kind: "edit"; pkg: PtPackage } | null
  >(null);

  const configDirty = draftAdvance !== config.bookInAdvanceDays;
  const active = packages.filter((p) => p.status === "active");
  const archived = packages.filter((p) => p.status === "archived");

  function handleSave(pkg: PtPackage) {
    setPackages((prev) =>
      prev.some((p) => p.id === pkg.id) ? prev.map((p) => (p.id === pkg.id ? pkg : p)) : [...prev, pkg]
    );
    setDialog(null);
  }

  function toggleArchive(id: string) {
    setPackages((prev) =>
      prev.map((p) =>
        p.id === id ? { ...p, status: p.status === "active" ? "archived" : "active" } : p
      )
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <PageHeader
        title="Private Sessions"
        description="PT packages clients can purchase. PT scheduling is client-driven via instructor availability — see Schedule. Cancellation policy lives in Global Policy."
        actions={
          <Button onClick={() => setDialog({ kind: "create" })}>
            <Plus className="h-4 w-4" /> Add package
          </Button>
        }
      />

      <section>
        <h2 className="mb-3 text-sm font-semibold text-ink">Booking config</h2>
        <form
          className="rounded-xl border border-border bg-card p-5 shadow-soft"
          onSubmit={(e) => {
            e.preventDefault();
            setConfig({ bookInAdvanceDays: draftAdvance });
            alert("Booking config updated (mock).");
          }}
        >
          <div className="flex flex-wrap items-end gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="advance">Book in advance (days)</Label>
              <Input
                id="advance"
                type="number"
                min={1}
                value={draftAdvance}
                onChange={(e) => setDraftAdvance(Number(e.target.value))}
                className="w-32"
              />
            </div>
            <div className="flex-1 text-xs text-muted">
              Maximum number of days ahead a client can submit a private session request.
            </div>
            <Button type="submit" disabled={!configDirty}>
              <Save className="h-4 w-4" /> Save
            </Button>
          </div>
        </form>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold text-ink">Packages</h2>
        {packages.length === 0 ? (
          <EmptyState title="No PT packages yet" description="Add your first private session package." />
        ) : (
          <div className="space-y-6">
            <PackageGroup
              title="Active"
              packages={active}
              onEdit={(pkg) => setDialog({ kind: "edit", pkg })}
              onArchive={(id) => toggleArchive(id)}
            />
            {archived.length > 0 && (
              <PackageGroup
                title="Archived"
                packages={archived}
                onEdit={(pkg) => setDialog({ kind: "edit", pkg })}
                onArchive={(id) => toggleArchive(id)}
                archived
              />
            )}
          </div>
        )}
      </section>

      {dialog && (
        <PtPackageDialog
          pkg={dialog.kind === "edit" ? dialog.pkg : null}
          onSave={handleSave}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  );
}

function PackageGroup({
  title,
  packages,
  onEdit,
  onArchive,
  archived,
}: {
  title: string;
  packages: PtPackage[];
  onEdit: (pkg: PtPackage) => void;
  onArchive: (id: string) => void;
  archived?: boolean;
}) {
  if (packages.length === 0) return null;
  return (
    <div>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">{title}</h3>
      <div className="grid gap-3 sm:grid-cols-2">
        {packages.map((pkg) => (
          <div
            key={pkg.id}
            className={`rounded-xl border border-border bg-card p-5 shadow-soft transition ${
              archived ? "opacity-70" : "hover:border-accent/40"
            }`}
          >
            <div className="mb-2 flex items-start justify-between gap-2">
              <div className="min-w-0">
                <h4 className="truncate text-base font-semibold text-ink">{pkg.name}</h4>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  <Badge tone={pkg.sessionType === "1on1" ? "accent" : "cyan"}>
                    {pkg.sessionType === "1on1" ? "1-on-1" : "2-on-1"}
                  </Badge>
                  <Badge tone="neutral">{pkg.numSessions} sessions</Badge>
                </div>
              </div>
            </div>
            <div className="mb-3 font-mono text-2xl font-semibold text-ink">
              {formatSgd(pkg.priceSgd)}
            </div>
            <div className="flex justify-end gap-1">
              <Button size="sm" variant="ghost" onClick={() => onEdit(pkg)}>
                <Pencil className="h-3.5 w-3.5" /> Edit
              </Button>
              <Button size="sm" variant="ghost" onClick={() => onArchive(pkg.id)}>
                {pkg.status === "archived" ? (
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
          </div>
        ))}
      </div>
    </div>
  );
}
