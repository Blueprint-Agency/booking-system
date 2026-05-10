"use client";
import { useState } from "react";
import { Plus, Pencil, Archive, RotateCcw } from "lucide-react";
import { Button, PageHeader, Badge, EmptyState } from "@/components/ui";
import { classPackages as seedPackages } from "@/data";
import { ClassPackageDialog } from "@/components/packages/class-package-dialog";
import { formatSgd } from "@/lib/formatters";
import type { ClassPackage } from "@/types";

export default function ClassPackagesPage() {
  const [packages, setPackages] = useState<ClassPackage[]>(seedPackages);
  const [dialog, setDialog] =
    useState<{ kind: "create" } | { kind: "edit"; pkg: ClassPackage } | null>(null);

  const active = packages.filter((p) => p.status === "active");
  const archived = packages.filter((p) => p.status === "archived");

  function handleSave(pkg: ClassPackage) {
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
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="Classes"
        description="Credit bundles and unlimited packages clients can purchase. Pre-requisite config — class scheduling happens on the Schedule page. Cancellation policy lives in Global Policy."
        actions={
          <Button onClick={() => setDialog({ kind: "create" })}>
            <Plus className="h-4 w-4" /> Add package
          </Button>
        }
      />

      {packages.length === 0 ? (
        <EmptyState title="No packages yet" description="Add your first credit bundle or unlimited pass." />
      ) : (
        <div className="space-y-6">
          <PackageGroup
            title="Credit bundles"
            description="Fixed number of credits valid for a period."
            packages={active.filter((p) => p.kind === "credit_bundle")}
            onEdit={(pkg) => setDialog({ kind: "edit", pkg })}
            onArchive={(id) => toggleArchive(id)}
          />
          <PackageGroup
            title="Unlimited"
            description="Time-based passes — unlimited classes for a duration."
            packages={active.filter((p) => p.kind === "unlimited")}
            onEdit={(pkg) => setDialog({ kind: "edit", pkg })}
            onArchive={(id) => toggleArchive(id)}
          />
          {archived.length > 0 && (
            <PackageGroup
              title="Archived"
              description={null}
              packages={archived}
              onEdit={(pkg) => setDialog({ kind: "edit", pkg })}
              onArchive={(id) => toggleArchive(id)}
              archived
            />
          )}
        </div>
      )}

      {dialog && (
        <ClassPackageDialog
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
  description,
  packages,
  onEdit,
  onArchive,
  archived,
}: {
  title: string;
  description: string | null;
  packages: ClassPackage[];
  onEdit: (pkg: ClassPackage) => void;
  onArchive: (id: string) => void;
  archived?: boolean;
}) {
  if (packages.length === 0) return null;
  return (
    <section>
      <div className="mb-3">
        <h2 className="text-sm font-semibold text-ink">{title}</h2>
        {description && <p className="text-xs text-muted">{description}</p>}
      </div>
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
                <h3 className="truncate text-base font-semibold text-ink">{pkg.name}</h3>
                <p className="text-xs text-muted">
                  {pkg.kind === "credit_bundle"
                    ? `${pkg.credits} credits · ${pkg.validityDays}-day validity`
                    : `${pkg.durationDays}-day pass`}
                </p>
              </div>
              {archived && <Badge tone="neutral">Archived</Badge>}
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
    </section>
  );
}
