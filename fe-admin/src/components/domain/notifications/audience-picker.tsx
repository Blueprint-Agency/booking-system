"use client";

import { useMemo } from "react";
import { useAdminState } from "@/lib/admin-state";
import { useWithTenant } from "@/lib/tenant-scope";
import { Select, Input, Label, Badge } from "@/components/ui";
import type { Broadcast } from "@/types";

export interface AudiencePickerProps {
  value: Broadcast["audience"];
  onChange: (v: Broadcast["audience"]) => void;
}

export function AudiencePicker({ value, onChange }: AudiencePickerProps) {
  const clients = useWithTenant(useAdminState((s) => s.clients));
  const allTags = useMemo(() => {
    const set = new Set<string>();
    for (const c of clients) for (const t of c.tags) set.add(t);
    return [...set].sort();
  }, [clients]);

  const count = useMemo(() => {
    if (value.kind === "all") return clients.length;
    if (value.kind === "tag") {
      const tag = String(value.value ?? "");
      return clients.filter((c) => c.tags.includes(tag)).length;
    }
    if (value.kind === "ids") return ((value.value as string[]) ?? []).length;
    return 0;
  }, [value, clients]);

  return (
    <div className="space-y-3 rounded-lg border border-border bg-card p-4">
      <div className="flex items-center justify-between">
        <Label>Audience</Label>
        <Badge tone="accent">{count} recipient{count === 1 ? "" : "s"}</Badge>
      </div>
      <Select
        value={value.kind}
        onChange={(e) =>
          onChange({ kind: e.target.value as Broadcast["audience"]["kind"], value: undefined })
        }
      >
        <option value="all">All clients</option>
        <option value="tag">By tag</option>
        <option value="ids">Specific client IDs</option>
      </Select>
      {value.kind === "tag" && (
        <Select
          value={(value.value as string) ?? ""}
          onChange={(e) => onChange({ kind: "tag", value: e.target.value })}
        >
          <option value="">Pick a tag…</option>
          {allTags.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </Select>
      )}
      {value.kind === "ids" && (
        <Input
          placeholder="comma-separated client IDs"
          value={((value.value as string[]) ?? []).join(",")}
          onChange={(e) =>
            onChange({
              kind: "ids",
              value: e.target.value
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean),
            })
          }
        />
      )}
    </div>
  );
}
