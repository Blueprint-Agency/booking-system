"use client";
import { useState } from "react";
import { Plus, Pencil, Archive, RotateCcw, AlertTriangle } from "lucide-react";
import { Button, PageHeader, Badge, EmptyState } from "@/components/ui";
import { classPackages as seedPackages } from "@/data";
import { ClassPackageDialog } from "@/components/packages/class-package-dialog";
import { formatSgd } from "@/lib/formatters";
import { getActivePromotion } from "@/lib/promotions";
import type { ClassPackage } from "@/types";

export default function ClassPackagesPage() {
  const [packages, setPackages] = useState<ClassPackage[]>(seedPackages);
  const [dialog, setDialog] =
    useState<{ kind: "create" } | { kind: "edit"; pkg: ClassPackage } | null>(null);

  const active = packages.filter((p) => p.status === "active");
  const archived = packages.filter((p) => p.status === "archived");
  const activeTrials = active.filter((p) => p.kind === "trial");

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
        description="Class packages clients can purchase. Trial Pass is one-time-only per client. Class scheduling happens on the Schedule page; cancellation policy lives in Global Policy."
        actions={
          <Button onClick={() => setDialog({ kind: "create" })}>
            <Plus className="h-4 w-4" /> Add package
          </Button>
        }
      />

      {packages.length === 0 ? (
        <EmptyState title="No packages yet" description="Add your first package." />
      ) : (
        <div className="space-y-6">
          <PackageGroup
            title="Trial Pass"
            description="A one-time-only introductory pass. Each client can purchase at most one."
            packages={active.filter((p) => p.kind === "trial")}
            onEdit={(pkg) => setDialog({ kind: "edit", pkg })}
            onArchive={(id) => toggleArchive(id)}
            warning={
              activeTrials.length > 1
                ? "Multiple active trial passes — clients will see the first."
                : null
            }
          />
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
  warning,
}: {
  title: string;
  description: string | null;
  packages: ClassPackage[];
  onEdit: (pkg: ClassPackage) => void;
  onArchive: (id: string) => void;
  archived?: boolean;
  warning?: string | null;
}) {
  if (packages.length === 0) return null;
  return (
    <section>
      <div className="mb-3">
        <h2 className="text-sm font-semibold text-ink">{title}</h2>
        {description && <p className="text-xs text-muted">{description}</p>}
        {warning && (
          <p className="mt-1 inline-flex items-center gap-1 rounded bg-warning/10 px-2 py-1 text-xs text-warning">
            <AlertTriangle className="h-3 w-3" /> {warning}
          </p>
        )}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {packages.map((pkg) => (
          <PackageCard
            key={pkg.id}
            pkg={pkg}
            archived={archived}
            onEdit={() => onEdit(pkg)}
            onArchive={() => onArchive(pkg.id)}
          />
        ))}
      </div>
    </section>
  );
}

function PackageCard({
  pkg,
  archived,
  onEdit,
  onArchive,
}: {
  pkg: ClassPackage;
  archived?: boolean;
  onEdit: () => void;
  onArchive: () => void;
}) {
  const promo = getActivePromotion(pkg);
  const future =
    !promo &&
    pkg.promotions.find((p) => new Date(p.startsAt) > new Date());
  const subtitle =
    pkg.kind === "credit_bundle"
      ? `${pkg.credits} credits · ${pkg.validityDays}-day validity`
      : pkg.kind === "unlimited"
      ? `${pkg.durationDays}-day pass`
      : pkg.kind === "trial"
      ? `${pkg.credits} class${(pkg.credits ?? 0) === 1 ? "" : "es"}${
          pkg.validityDays ? ` · ${pkg.validityDays}-day validity` : " · no expiry"
        }`
      : "";
  return (
    <div
      className={`rounded-xl border border-border bg-card p-5 shadow-soft transition ${
        archived ? "opacity-70" : "hover:border-accent/40"
      }`}
    >
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="truncate text-base font-semibold text-ink">{pkg.name}</h3>
          <p className="text-xs text-muted">{subtitle}</p>
        </div>
        <div className="flex flex-col items-end gap-1">
          {archived && <Badge tone="neutral">Archived</Badge>}
          {promo && (
            <span className="rounded-full bg-sage/15 px-2 py-0.5 text-[10px] uppercase text-sage">
              Promo ·{" "}
              {promo.mode === "percent"
                ? `-${promo.percent}%`
                : `S$${promo.priceSgd}`}
            </span>
          )}
          {!promo && future && (
            <span className="rounded-full bg-paper px-2 py-0.5 text-[10px] uppercase text-muted">
              Promo · starts {new Date(future.startsAt).toLocaleDateString()}
            </span>
          )}
        </div>
      </div>
      {pkg.description && (
        <p className="mb-3 line-clamp-2 text-xs text-muted">{pkg.description}</p>
      )}
      <div className="mb-3 font-mono text-2xl font-semibold text-ink">
        {formatSgd(pkg.priceSgd)}
      </div>
      <div className="flex justify-end gap-1">
        <Button size="sm" variant="ghost" onClick={onEdit}>
          <Pencil className="h-3.5 w-3.5" /> Edit
        </Button>
        <Button size="sm" variant="ghost" onClick={onArchive}>
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
  );
}
