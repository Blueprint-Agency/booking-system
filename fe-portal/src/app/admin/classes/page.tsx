"use client";
import { useCallback, useEffect, useState } from "react";
import { Plus, Pencil, Archive, AlertTriangle, Loader2, RotateCcw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button, PageHeader, Badge, EmptyState, Tabs, TabsList, TabsTrigger } from "@/components/ui";
import { ClassPackageDialog } from "@/components/packages/class-package-dialog";
import { formatSgd } from "@/lib/formatters";
import { useWorkspace } from "@/lib/workspace-context";
import { ApiError } from "@/lib/api";
import type { ClassPackage, ClassPackageKind, Promotion } from "@/types";
import {
  promotionFromApi,
  promotionToApiPayload,
  type ApiPromotion,
} from "@/lib/promotions";

interface ApiClassPackage {
  id: string;
  name: string;
  description: string | null;
  kind: ClassPackageKind;
  credits: number | null;
  validity_days: number | null;
  duration_days: number | null;
  price_sgd: string;
  status: "active" | "archived";
  archived_at: string | null;
  promotions?: ApiPromotion[];
}

function fromApi(r: ApiClassPackage): ClassPackage {
  return {
    id: r.id,
    name: r.name,
    description: r.description ?? "",
    kind: r.kind,
    credits: r.credits,
    validityDays: r.validity_days,
    durationDays: r.duration_days,
    priceSgd: Number(r.price_sgd),
    status: r.status,
    promotions: (r.promotions ?? []).map(promotionFromApi),
  };
}

export default function ClassPackagesPage() {
  const { api } = useWorkspace();
  const [packages, setPackages] = useState<ClassPackage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] =
    useState<{ kind: "create" } | { kind: "edit"; pkg: ClassPackage } | null>(null);
  const [view, setView] = useState<"active" | "archived">("active");

  const load = useCallback(async () => {
    if (!api) return;
    setLoading(true);
    setError(null);
    try {
      const data = await api.get<{ class_packages: ApiClassPackage[] }>(
        "/portal/admin/class-packages",
      );
      setPackages(data.class_packages.map(fromApi));
    } catch (err) {
      setError(err instanceof ApiError ? `HTTP ${err.status}` : "Network error");
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  const active = packages.filter((p) => p.status === "active");
  const archived = packages.filter((p) => p.status === "archived");
  const activeTrials = active.filter((p) => p.kind === "trial");

  async function handleSave(pkg: ClassPackage) {
    if (!api) return;
    const isEdit = packages.some((p) => p.id === pkg.id);
    const payload = {
      name: pkg.name,
      description: pkg.description || null,
      credits: pkg.credits ?? null,
      validity_days: pkg.validityDays ?? null,
      duration_days: pkg.durationDays ?? null,
      price_sgd: String(pkg.priceSgd),
      promotions: pkg.promotions.map(promotionToApiPayload),
    };
    try {
      if (isEdit) {
        await api.patch(`/portal/admin/class-packages/${pkg.id}`, payload);
      } else {
        await api.post("/portal/admin/class-packages", { ...payload, kind: pkg.kind });
      }
      setDialog(null);
      await load();
      toast.success("Package saved.");
    } catch (err) {
      toast.error(err instanceof ApiError ? `Save failed (HTTP ${err.status}).` : "Save failed.");
    }
  }

  async function archive(pkg: ClassPackage) {
    if (!api) return;
    try {
      await api.post(`/portal/admin/class-packages/${pkg.id}/archive`);
      await load();
      toast.success("Package archived.");
    } catch (err) {
      toast.error(err instanceof ApiError ? `Archive failed (HTTP ${err.status}).` : "Archive failed.");
    }
  }

  async function unarchive(pkg: ClassPackage) {
    if (!api) return;
    try {
      await api.post(`/portal/admin/class-packages/${pkg.id}/unarchive`);
      await load();
      toast.success("Package restored.");
    } catch (err) {
      if (err instanceof ApiError) {
        const body = err.body as { error?: string; message?: string } | null;
        toast.error(body?.message ?? body?.error ?? `Unarchive failed (HTTP ${err.status}).`);
      } else {
        toast.error("Unarchive failed.");
      }
    }
  }

  async function handleDelete(pkg: ClassPackage) {
    if (!api) return;
    if (!window.confirm("Delete this package? It will be removed from the UI and cannot be restored.")) {
      return;
    }
    try {
      await api.del(`/portal/admin/class-packages/${pkg.id}`);
      setPackages((prev) => prev.filter((p) => p.id !== pkg.id));
      toast.success("Package deleted.");
    } catch (err) {
      if (err instanceof ApiError) {
        const body = err.body as { error?: string; message?: string } | null;
        toast.error(body?.message ?? body?.error ?? `Delete failed (HTTP ${err.status}).`);
      } else {
        toast.error("Delete failed.");
      }
    }
  }

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="Classes"
        description="Class packages customers can purchase. Trial Pass is one-time-only per customer. Class scheduling happens on the Schedule page; cancellation policy lives in Global Policy."
        actions={
          <Button onClick={() => setDialog({ kind: "create" })}>
            <Plus className="h-4 w-4" /> Add package
          </Button>
        }
      />

      {loading ? (
        <div className="flex h-32 items-center justify-center gap-2 text-sm text-muted">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading packages…
        </div>
      ) : error ? (
        <div className="rounded-xl border border-error/30 bg-error/5 p-6 text-center">
          <p className="text-sm text-error">Failed to load: {error}</p>
          <Button size="sm" variant="ghost" onClick={load} className="mt-2">
            Retry
          </Button>
        </div>
      ) : packages.length === 0 ? (
        <EmptyState
          title="No packages yet"
          description="Start with a Trial Pass, then add credit bundles."
          cta={
            <Button onClick={() => setDialog({ kind: "create" })}>
              <Plus className="h-4 w-4" /> Add package
            </Button>
          }
        />
      ) : (
        <div>
          {active.length + archived.length > 0 && (
            <Tabs value={view} onValueChange={(v) => setView(v as "active" | "archived")} className="mb-6">
              <TabsList>
                <TabsTrigger value="active">Active ({active.length})</TabsTrigger>
                <TabsTrigger value="archived">Archived ({archived.length})</TabsTrigger>
              </TabsList>
            </Tabs>
          )}
          {view === "active" && (
            <div className="space-y-6">
              <PackageGroup
                title="Trial Pass"
                description="A one-time-only introductory pass. Each customer can purchase at most one."
                packages={active.filter((p) => p.kind === "trial")}
                onEdit={(pkg) => setDialog({ kind: "edit", pkg })}
                onArchive={archive}
                warning={
                  activeTrials.length > 1
                    ? "Multiple active trial passes — customers will see the first."
                    : null
                }
              />
              <PackageGroup
                title="Credit bundles"
                description="Fixed number of credits valid for a period."
                packages={active
                  .filter((p) => p.kind === "credit_bundle")
                  .sort((a, b) => (a.credits ?? 0) - (b.credits ?? 0))}
                onEdit={(pkg) => setDialog({ kind: "edit", pkg })}
                onArchive={archive}
              />
              <PackageGroup
                title="Unlimited"
                description="Time-based passes — unlimited classes for a duration."
                packages={active.filter((p) => p.kind === "unlimited")}
                onEdit={(pkg) => setDialog({ kind: "edit", pkg })}
                onArchive={archive}
              />
            </div>
          )}
          {view === "archived" &&
            (archived.length === 0 ? (
              <EmptyState
                title="No archived packages"
                description="Archived packages will appear here."
              />
            ) : (
              <PackageGroup
                title="Archived"
                description={null}
                packages={archived}
                onEdit={(pkg) => setDialog({ kind: "edit", pkg })}
                onArchive={archive}
                onUnarchive={unarchive}
                onDelete={handleDelete}
                archived
              />
            ))}
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
  onUnarchive,
  onDelete,
  archived,
  warning,
}: {
  title: string;
  description: string | null;
  packages: ClassPackage[];
  onEdit: (pkg: ClassPackage) => void;
  onArchive: (pkg: ClassPackage) => void;
  onUnarchive?: (pkg: ClassPackage) => void;
  onDelete?: (pkg: ClassPackage) => void;
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
            onArchive={() => onArchive(pkg)}
            onUnarchive={onUnarchive ? () => onUnarchive(pkg) : undefined}
            onDelete={onDelete ? () => onDelete(pkg) : undefined}
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
  onUnarchive,
  onDelete,
}: {
  pkg: ClassPackage;
  archived?: boolean;
  onEdit: () => void;
  onArchive: () => void;
  onUnarchive?: () => void;
  onDelete?: () => void;
}) {
  const heading =
    pkg.kind === "credit_bundle"
      ? `${pkg.credits} ${(pkg.credits ?? 0) === 1 ? "credit" : "credits"}`
      : pkg.name;
  const subtitleLines: string[] =
    pkg.kind === "credit_bundle"
      ? [pkg.name, `${pkg.validityDays}-day validity`]
      : pkg.kind === "unlimited"
      ? [`${pkg.durationDays}-day pass`]
      : pkg.kind === "trial"
      ? [
          `${pkg.credits} class${(pkg.credits ?? 0) === 1 ? "" : "es"}`,
          pkg.validityDays ? `${pkg.validityDays}-day validity` : "no expiry",
        ]
      : [];
  return (
    <div
      className={`rounded-xl border border-border bg-card p-5 shadow-soft transition ${
        archived ? "opacity-70" : "hover:border-accent/40"
      }`}
    >
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="truncate text-base font-semibold text-ink">{heading}</h3>
          {subtitleLines.map((line) => (
            <p key={line} className="text-xs text-muted">
              {line}
            </p>
          ))}
        </div>
        {archived && <Badge tone="neutral">Archived</Badge>}
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
        {pkg.status === "active" && (
          <Button size="sm" variant="ghost" onClick={onArchive}>
            <Archive className="h-3.5 w-3.5" /> Archive
          </Button>
        )}
        {pkg.status === "archived" && onUnarchive && (
          <Button size="sm" variant="ghost" onClick={onUnarchive}>
            <RotateCcw className="h-3.5 w-3.5" /> Unarchive
          </Button>
        )}
        {pkg.status === "archived" && onDelete && (
          <Button size="sm" variant="ghost" onClick={onDelete}>
            <Trash2 className="h-3.5 w-3.5" /> Delete
          </Button>
        )}
      </div>
    </div>
  );
}
