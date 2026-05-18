"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Plus, MapPin, Loader2 } from "lucide-react";
import { Button, PageHeader, Badge, EmptyState } from "@/components/ui";
import { useWorkspace } from "@/lib/workspace-context";
import { ApiError } from "@/lib/api";

interface ApiWorkshop {
  id: string;
  name: string;
  class_type_id: string;
  location_id: string;
  lifecycle: "active" | "cancelled";
}

interface ApiClassType {
  id: string;
  name: string;
}

export default function WorkshopsListPage() {
  const { api, activeLocationId, locations } = useWorkspace();
  const [workshops, setWorkshops] = useState<ApiWorkshop[]>([]);
  const [classTypes, setClassTypes] = useState<ApiClassType[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!api) return;
    setLoading(true);
    setError(null);
    try {
      const [ws, ct] = await Promise.all([
        api.get<{ workshops: ApiWorkshop[] }>("/portal/admin/workshops"),
        api.get<{ class_types: ApiClassType[] }>("/portal/admin/class-types"),
      ]);
      setWorkshops(ws.workshops);
      setClassTypes(ct.class_types);
    } catch (err) {
      setError(err instanceof ApiError ? `HTTP ${err.status}` : "Network error");
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = workshops.filter(
    (w) => !activeLocationId || w.location_id === activeLocationId,
  );
  const active = filtered.filter((w) => w.lifecycle === "active");
  const cancelled = filtered.filter((w) => w.lifecycle === "cancelled");

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader
        title="Workshops"
        description="Configure upcoming workshops. Each day appears on the schedule automatically once configured."
        actions={
          <Link href="/admin/packages/workshops/new">
            <Button>
              <Plus className="h-4 w-4" /> New workshop
            </Button>
          </Link>
        }
      />

      {loading ? (
        <div className="flex h-32 items-center justify-center gap-2 text-sm text-muted">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading workshops…
        </div>
      ) : error ? (
        <div className="rounded-xl border border-error/30 bg-error/5 p-6 text-center">
          <p className="text-sm text-error">Failed to load: {error}</p>
          <Button size="sm" variant="ghost" onClick={load} className="mt-2">
            Retry
          </Button>
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          title="No workshops yet"
          description="Create one to see it appear on the schedule."
          cta={
            <Link href="/admin/packages/workshops/new">
              <Button>
                <Plus className="h-4 w-4" /> New workshop
              </Button>
            </Link>
          }
        />
      ) : (
        <>
          {active.length > 0 && (
            <Section
              title="Active"
              workshops={active}
              classTypes={classTypes}
              locations={locations.map((l) => ({ id: l.id, name: l.name }))}
            />
          )}
          {cancelled.length > 0 && (
            <details className="rounded-xl border border-border bg-card p-3">
              <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wider text-muted">
                Cancelled ({cancelled.length})
              </summary>
              <div className="mt-3">
                <Section
                  title=""
                  workshops={cancelled}
                  classTypes={classTypes}
                  locations={locations.map((l) => ({ id: l.id, name: l.name }))}
                />
              </div>
            </details>
          )}
        </>
      )}
    </div>
  );
}

function Section({
  title,
  workshops,
  classTypes,
  locations,
}: {
  title: string;
  workshops: ApiWorkshop[];
  classTypes: ApiClassType[];
  locations: Array<{ id: string; name: string }>;
}) {
  return (
    <div className="space-y-2">
      {title && (
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted">{title}</h2>
      )}
      <ul className="divide-y divide-border rounded-xl border border-border bg-card shadow-soft">
        {workshops.map((w) => (
          <li key={w.id} className="flex items-center justify-between gap-4 px-4 py-3">
            <div className="min-w-0">
              <Link
                href={`/admin/packages/workshops/${w.id}/edit`}
                className="font-medium text-ink hover:text-accent"
              >
                {w.name}
              </Link>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted">
                <Badge tone="accent">
                  {classTypes.find((c) => c.id === w.class_type_id)?.name ?? "—"}
                </Badge>
                <span className="inline-flex items-center gap-1">
                  <MapPin className="h-3 w-3" />
                  {locations.find((l) => l.id === w.location_id)?.name ?? "—"}
                </span>
                {w.lifecycle === "cancelled" && <Badge tone="neutral">Cancelled</Badge>}
              </div>
            </div>
            <Link href={`/admin/packages/workshops/${w.id}/edit`}>
              <Button size="sm" variant="ghost">
                Edit
              </Button>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
