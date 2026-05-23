"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Plus, Loader2 } from "lucide-react";
import { Button, PageHeader, Badge, EmptyState } from "@/components/ui";
import { useWorkspace } from "@/lib/workspace-context";
import { ApiError } from "@/lib/api";
import { formatSgd, formatDate } from "@/lib/formatters";

interface ApiCorporatePackage {
  id: string;
  name: string;
  description: string | null;
  price_sgd: string;
  status: "active" | "archived";
  archived_at: string | null;
  created_at: string;
  created_by_staff_id: string | null;
}

export default function CorporatePackagesListPage() {
  // Corporate packages are admin-only and not visible to members. We list all
  // rows (active + archived) so admins can manage the full catalog.
  const { api } = useWorkspace();
  const [packages, setPackages] = useState<ApiCorporatePackage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!api) return;
    setLoading(true);
    setError(null);
    try {
      const res = await api.get<{ corporatePackages: ApiCorporatePackage[] }>(
        "/portal/admin/corporate-packages",
      );
      setPackages(res.corporatePackages);
    } catch (err) {
      setError(err instanceof ApiError ? `HTTP ${err.status}` : "Network error");
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader
        title="Corporate Packages"
        description="B2B offerings used to schedule corporate sessions. Admin-only — not visible to members."
        actions={
          <Link href="/admin/packages/corporate/new">
            <Button>
              <Plus className="h-4 w-4" /> New corporate package
            </Button>
          </Link>
        }
      />

      {loading ? (
        <div className="flex h-32 items-center justify-center gap-2 text-sm text-muted">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
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
          title="No corporate packages yet"
          description="Create one to start scheduling corporate sessions against it."
          cta={{ href: "/admin/packages/corporate/new", label: "New corporate package" }}
        />
      ) : (
        <ul className="divide-y divide-border rounded-xl border border-border bg-card shadow-soft">
          {packages.map((p) => (
            <li key={p.id}>
              <Link
                href={`/admin/packages/corporate/${p.id}/edit`}
                className="flex items-center justify-between gap-4 px-4 py-3 hover:bg-paper"
              >
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-ink">{p.name}</div>
                  <div className="mt-1 text-xs text-muted">
                    Created {formatDate(p.created_at)}
                  </div>
                </div>
                <div className="hidden sm:block min-w-[110px] text-right text-sm text-ink">
                  {formatSgd(Number(p.price_sgd))}
                </div>
                <div className="min-w-[80px] text-right">
                  {p.status === "archived" ? (
                    <Badge tone="neutral">Archived</Badge>
                  ) : (
                    <Badge tone="sage">Active</Badge>
                  )}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
