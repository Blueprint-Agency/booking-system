"use client";

import { useMemo } from "react";
import { toast } from "sonner";
import { useAdminState, setState } from "@/lib/admin-state";
import { appendAuditEntry } from "@/lib/audit";
import { PageHeader, Badge, EmptyState } from "@/components/ui";

export default function FeatureFlagsPage() {
  const flags = useAdminState((s) => s.featureFlags);

  const grouped = useMemo(() => {
    const m = new Map<string, typeof flags>();
    for (const f of flags) {
      const arr = m.get(f.key) ?? [];
      arr.push(f);
      m.set(f.key, arr);
    }
    return m;
  }, [flags]);

  const toggle = (key: string, tenantId: string | "*") => {
    setState((s) => {
      const before = s.featureFlags.find((f) => f.key === key && f.tenantId === tenantId);
      const flagsNext = s.featureFlags.map((f) =>
        f.key === key && f.tenantId === tenantId ? { ...f, enabled: !f.enabled } : f,
      );
      if (before) {
        const after = flagsNext.find((f) => f.key === key && f.tenantId === tenantId)!;
        appendAuditEntry({
          action: "featureFlag.set",
          entityType: "FeatureFlag",
          entityId: `${key}:${tenantId}`,
          before,
          after,
          note: `Toggled ${key} for ${tenantId} → ${after.enabled}`,
        });
      }
      return { ...s, featureFlags: flagsNext };
    });
    toast.success("Toggled");
  };

  if (flags.length === 0) {
    return (
      <>
        <PageHeader title="Feature flags" />
        <EmptyState title="No feature flags" description="Add flags in the seed data." />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Feature flags"
        description="Per-tenant or global rollout toggles. Audit-logged."
      />
      <div className="mt-6 space-y-3">
        {[...grouped.entries()].map(([key, list]) => (
          <div key={key} className="rounded-lg border border-border bg-card p-4">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-ink">{key}</h3>
              <Badge tone="neutral">{list.filter((f) => f.enabled).length} enabled</Badge>
            </div>
            <ul className="divide-y divide-border">
              {list.map((f) => (
                <li
                  key={`${f.key}:${f.tenantId}`}
                  className="flex items-center justify-between gap-3 py-2 text-sm"
                >
                  <span className="text-ink">
                    {f.tenantId === "*" ? "Global" : f.tenantId}
                  </span>
                  <label className="inline-flex cursor-pointer items-center gap-2 text-xs">
                    <span className={f.enabled ? "text-sage" : "text-muted"}>
                      {f.enabled ? "On" : "Off"}
                    </span>
                    <input
                      type="checkbox"
                      checked={f.enabled}
                      onChange={() => toggle(f.key, f.tenantId)}
                      className="h-4 w-4 rounded border-border accent-accent"
                    />
                  </label>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </>
  );
}
