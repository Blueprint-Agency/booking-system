"use client";
import { LoadFailure } from "@/components/ui/load-failure";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Plus, Loader2 } from "lucide-react";
import {
  Button,
  PageHeader,
  Badge,
  EmptyState,
  Pagination,
  usePaged,
} from "@/components/ui";
import { useStudioZone } from "@/components/brand/brand-provider";
import { useWorkspace } from "@/lib/workspace-context";
import { ApiError } from "@/lib/api";
import { formatSgd, formatDate } from "@/lib/formatters";
import { EntityBadge, EntityFilter } from "@/components/packages/entity-filter";
import { filterByEntity, packageEntityFromApi } from "@/lib/entities";
import { useEntities } from "@/lib/use-entities";

interface ApiCorporatePackage {
  id: string;
  // Optional: an API that predates Entities does not send them.
  entity_id?: string | null;
  entity?: { id: string; name: string; slug: string } | null;
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
  const timezone = useStudioZone();
  const [packages, setPackages] = useState<ApiCorporatePackage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // The studio's Entities: for the filter, which is hidden at one. "" is every Entity.
  const { entities } = useEntities();
  const [entityFilter, setEntityFilter] = useState("");
  const shown = filterByEntity(
    packages.map((p) => ({ ...p, ...packageEntityFromApi(p) })),
    entityFilter,
  );
  const { visible, pagination } = usePaged(shown);

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
        <LoadFailure what="the corporate packages" onRetry={load} className="rounded-xl border border-border bg-card" />
      ) : packages.length === 0 ? (
        <EmptyState
          title="No corporate packages yet"
          description="Create one to start scheduling corporate sessions against it."
          cta={{ href: "/admin/packages/corporate/new", label: "New corporate package" }}
        />
      ) : (
        <div>
        <EntityFilter entities={entities} value={entityFilter} onChange={setEntityFilter} />
        <div className="overflow-hidden rounded-xl border border-border bg-card shadow-soft">
          <ul className="divide-y divide-border">
            {visible.map((p) => (
              <li key={p.id}>
                <Link
                  href={`/admin/packages/corporate/${p.id}/edit`}
                  className="flex items-center justify-between gap-4 px-4 py-3 hover:bg-paper"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="break-words font-medium text-ink">{p.name}</span>
                      <EntityBadge name={p.entityName} />
                    </div>
                    <div className="mt-1 text-xs text-muted">
                      {/* The price column is hidden on a phone; it rides here. */}
                      <span className="text-ink sm:hidden">
                        {formatSgd(Number(p.price_sgd))} ·{" "}
                      </span>
                      Created {formatDate(timezone, p.created_at)}
                    </div>
                  </div>
                  <div className="hidden sm:block min-w-[110px] text-right text-sm text-ink">
                    {formatSgd(Number(p.price_sgd))}
                  </div>
                  <div className="shrink-0 text-right sm:min-w-[80px]">
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
          <Pagination {...pagination} noun="corporate packages" />
        </div>
        </div>
      )}
    </div>
  );
}
