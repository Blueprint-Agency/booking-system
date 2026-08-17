"use client";
import { useCallback, useEffect, useState } from "react";
import { Plus, Pencil, Archive, Save, Loader2, RotateCcw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button, PageHeader, Badge, EmptyState, Input, Label, Tabs, TabsList, TabsTrigger } from "@/components/ui";
import { PtPackageDialog } from "@/components/packages/pt-package-dialog";
import { formatSgd } from "@/lib/formatters";
import { useWorkspace } from "@/lib/workspace-context";
import { ApiError } from "@/lib/api";
import type { PtPackage, PtSessionType } from "@/types";
import {
  promotionFromApi,
  promotionToApiPayload,
  type ApiPromotion,
} from "@/lib/promotions";

interface ApiPtPackage {
  id: string;
  name: string;
  session_type: PtSessionType;
  num_sessions: number;
  price_sgd: string;
  status: "active" | "archived";
  archived_at: string | null;
  promotions?: ApiPromotion[];
}

function fromApi(r: ApiPtPackage): PtPackage {
  return {
    id: r.id,
    name: r.name,
    sessionType: r.session_type,
    numSessions: r.num_sessions,
    priceSgd: Number(r.price_sgd),
    status: r.status,
    promotions: (r.promotions ?? []).map(promotionFromApi),
  };
}

export default function PrivateSessionsPage() {
  const { api } = useWorkspace();
  const [packages, setPackages] = useState<PtPackage[]>([]);
  const [advance, setAdvance] = useState<number>(30);
  const [draftAdvance, setDraftAdvance] = useState<number>(30);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingConfig, setSavingConfig] = useState(false);
  const [dialog, setDialog] = useState<
    { kind: "create" } | { kind: "edit"; pkg: PtPackage } | null
  >(null);
  const [view, setView] = useState<"active" | "archived">("active");

  const load = useCallback(async () => {
    if (!api) return;
    setLoading(true);
    setError(null);
    try {
      const [pkgs, policy] = await Promise.all([
        api.get<{ pt_packages: ApiPtPackage[] }>("/portal/admin/pt-packages"),
        api.get<{
          pt_booking_config: { book_in_advance_days: number };
        }>("/portal/admin/policy"),
      ]);
      setPackages(pkgs.pt_packages.map(fromApi));
      setAdvance(policy.pt_booking_config.book_in_advance_days);
      setDraftAdvance(policy.pt_booking_config.book_in_advance_days);
    } catch (err) {
      setError(err instanceof ApiError ? `HTTP ${err.status}` : "Network error");
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  const configDirty = draftAdvance !== advance;
  const active = packages.filter((p) => p.status === "active");
  const archived = packages.filter((p) => p.status === "archived");

  async function handleSavePackage(pkg: PtPackage) {
    if (!api) return;
    const isEdit = packages.some((p) => p.id === pkg.id);
    try {
      const promosPayload = pkg.promotions.map(promotionToApiPayload);
      if (isEdit) {
        await api.patch(`/portal/admin/pt-packages/${pkg.id}`, {
          name: pkg.name,
          num_sessions: pkg.numSessions,
          price_sgd: String(pkg.priceSgd),
          promotions: promosPayload,
        });
      } else {
        await api.post("/portal/admin/pt-packages", {
          name: pkg.name,
          session_type: pkg.sessionType,
          num_sessions: pkg.numSessions,
          price_sgd: String(pkg.priceSgd),
          promotions: promosPayload,
        });
      }
      setDialog(null);
      await load();
      toast.success("PT package saved.");
    } catch (err) {
      toast.error(err instanceof ApiError ? `Save failed (HTTP ${err.status}).` : "Save failed.");
    }
  }

  async function archive(pkg: PtPackage) {
    if (!api) return;
    try {
      await api.post(`/portal/admin/pt-packages/${pkg.id}/archive`);
      await load();
      toast.success("PT package archived.");
    } catch (err) {
      toast.error(err instanceof ApiError ? `Archive failed (HTTP ${err.status}).` : "Archive failed.");
    }
  }

  async function unarchive(pkg: PtPackage) {
    if (!api) return;
    try {
      await api.post(`/portal/admin/pt-packages/${pkg.id}/unarchive`);
      await load();
      toast.success("PT package restored.");
    } catch (err) {
      if (err instanceof ApiError) {
        const body = err.body as { error?: string; message?: string } | null;
        toast.error(body?.message ?? body?.error ?? `Unarchive failed (HTTP ${err.status}).`);
      } else {
        toast.error("Unarchive failed.");
      }
    }
  }

  async function handleDelete(pkg: PtPackage) {
    if (!api) return;
    if (!window.confirm("Delete this PT package? It will be removed from the UI and cannot be restored.")) {
      return;
    }
    try {
      await api.del(`/portal/admin/pt-packages/${pkg.id}`);
      setPackages((prev) => prev.filter((p) => p.id !== pkg.id));
      toast.success("PT package deleted.");
    } catch (err) {
      if (err instanceof ApiError) {
        const body = err.body as { error?: string; message?: string } | null;
        toast.error(body?.message ?? body?.error ?? `Delete failed (HTTP ${err.status}).`);
      } else {
        toast.error("Delete failed.");
      }
    }
  }

  async function handleSaveConfig(e: React.FormEvent) {
    e.preventDefault();
    if (!api) return;
    setSavingConfig(true);
    try {
      await api.patch("/portal/admin/policy/pt", {
        book_in_advance_days: draftAdvance,
      });
      setAdvance(draftAdvance);
      toast.success("Booking config saved.");
    } catch (err) {
      toast.error(err instanceof ApiError ? `Save failed (HTTP ${err.status}).` : "Save failed.");
    } finally {
      setSavingConfig(false);
    }
  }

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center gap-2 text-sm text-muted">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading…
      </div>
    );
  }
  if (error) {
    return (
      <div className="mx-auto max-w-3xl rounded-xl border border-error/30 bg-error/5 p-6 text-center">
        <p className="text-sm text-error">Failed to load: {error}</p>
        <Button size="sm" variant="ghost" onClick={load} className="mt-2">
          Retry
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <PageHeader
        title="Private Sessions"
        description="PT packages customers can purchase. PT is request-driven — customers submit preferred slots in the app; triage and schedule them under PT Requests. Cancellation policy lives in Global Policy."
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
          onSubmit={handleSaveConfig}
        >
          <div className="flex flex-wrap items-end gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="advance">Book in advance (days)</Label>
              <Input
                id="advance"
                type="number"
                min={1}
                max={365}
                value={draftAdvance}
                onChange={(e) => setDraftAdvance(Number(e.target.value))}
                className="w-32"
              />
            </div>
            <div className="flex-1 text-xs text-muted">
              Maximum number of days ahead a customer can submit a private session request.
            </div>
            <Button type="submit" disabled={!configDirty || savingConfig}>
              {savingConfig ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Saving…
                </>
              ) : (
                <>
                  <Save className="h-4 w-4" /> Save
                </>
              )}
            </Button>
          </div>
        </form>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold text-ink">Packages</h2>
        {packages.length === 0 ? (
          <EmptyState title="No PT packages yet" description="Add your first private session package." />
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
                  title="Active"
                  packages={active}
                  onEdit={(pkg) => setDialog({ kind: "edit", pkg })}
                  onArchive={archive}
                />
              </div>
            )}
            {view === "archived" &&
              (archived.length === 0 ? (
                <EmptyState
                  title="No archived PT packages"
                  description="Archived PT packages will appear here."
                />
              ) : (
                <PackageGroup
                  title="Archived"
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
      </section>

      {dialog && (
        <PtPackageDialog
          pkg={dialog.kind === "edit" ? dialog.pkg : null}
          onSave={handleSavePackage}
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
  onUnarchive,
  onDelete,
  archived,
}: {
  title: string;
  packages: PtPackage[];
  onEdit: (pkg: PtPackage) => void;
  onArchive: (pkg: PtPackage) => void;
  onUnarchive?: (pkg: PtPackage) => void;
  onDelete?: (pkg: PtPackage) => void;
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
            <div className="mb-3 text-2xl font-semibold tabular-nums text-ink">
              {formatSgd(pkg.priceSgd)}
            </div>
            <div className="flex justify-end gap-1">
              <Button size="sm" variant="ghost" onClick={() => onEdit(pkg)}>
                <Pencil className="h-3.5 w-3.5" /> Edit
              </Button>
              {pkg.status === "active" && (
                <Button size="sm" variant="ghost" onClick={() => onArchive(pkg)}>
                  <Archive className="h-3.5 w-3.5" /> Archive
                </Button>
              )}
              {pkg.status === "archived" && onUnarchive && (
                <Button size="sm" variant="ghost" onClick={() => onUnarchive(pkg)}>
                  <RotateCcw className="h-3.5 w-3.5" /> Unarchive
                </Button>
              )}
              {pkg.status === "archived" && onDelete && (
                <Button size="sm" variant="ghost" onClick={() => onDelete(pkg)}>
                  <Trash2 className="h-3.5 w-3.5" /> Delete
                </Button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
