"use client";

import { useMemo, useState } from "react";
import { ChevronRight } from "lucide-react";
import type { AdminUser, AuditEntry } from "@/types";
import { Badge, Tooltip, EmptyState } from "@/components/ui";
import { DataTable, type DataTableColumn } from "@/components/data-table";
import { formatDateTime, formatRelative } from "@/lib/formatters";
import { cn } from "@/lib/utils";
import { AuditFilters, EMPTY_AUDIT_FILTER, type AuditFilterValue } from "./audit-filters";

export interface AuditLogTableProps {
  rows: AuditEntry[];
  actors: AdminUser[];
}

export function AuditLogTable({ rows, actors }: AuditLogTableProps) {
  const [filter, setFilter] = useState<AuditFilterValue>(EMPTY_AUDIT_FILTER);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const actorName = useMemo(() => {
    const map = new Map(actors.map((a) => [a.id, a.name]));
    return (id: string) => map.get(id) ?? id;
  }, [actors]);

  const filtered = useMemo(() => {
    const fromMs = filter.from ? new Date(filter.from + "T00:00:00").getTime() : null;
    const toMs = filter.to ? new Date(filter.to + "T23:59:59").getTime() : null;
    const text = filter.text.trim().toLowerCase();
    return rows.filter((r) => {
      if (filter.actorId && r.actorId !== filter.actorId) return false;
      if (filter.action && r.action !== filter.action) return false;
      const ts = Date.parse(r.ts);
      if (fromMs !== null && ts < fromMs) return false;
      if (toMs !== null && ts > toMs) return false;
      if (text) {
        const hay = `${r.entityType} ${r.entityId} ${r.note ?? ""}`.toLowerCase();
        if (!hay.includes(text)) return false;
      }
      return true;
    });
  }, [rows, filter]);

  const columns: DataTableColumn<AuditEntry>[] = [
    {
      key: "ts",
      header: "When",
      sortable: true,
      sortValue: (r) => r.ts,
      width: "w-40",
      cell: (r) => (
        <Tooltip content={formatDateTime(r.ts)}>
          <span className="text-ink">{formatRelative(r.ts)}</span>
        </Tooltip>
      ),
    },
    {
      key: "actor",
      header: "Actor",
      cell: (r) => (
        <div className="flex flex-col">
          <span className="text-ink">{actorName(r.actorId)}</span>
          <span className="text-xs text-muted">{r.actorRole}</span>
        </div>
      ),
    },
    {
      key: "action",
      header: "Action",
      sortable: true,
      sortValue: (r) => r.action,
      cell: (r) => <Badge tone={actionTone(r.action)}>{r.action}</Badge>,
    },
    {
      key: "entity",
      header: "Entity",
      cell: (r) => (
        <div className="flex flex-col">
          <span className="text-ink">{r.entityType}</span>
          <span className="text-xs font-mono text-muted">{r.entityId}</span>
        </div>
      ),
    },
    {
      key: "note",
      header: "Note",
      cell: (r) => <span className="text-sm text-muted">{r.note ?? "—"}</span>,
    },
    {
      key: "diff",
      header: "",
      width: "w-10",
      cell: (r) => (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setExpanded((prev) => ({ ...prev, [r.id]: !prev[r.id] }));
          }}
          className="text-muted hover:text-ink"
          aria-label="Toggle diff"
        >
          <ChevronRight className={cn("h-4 w-4 transition-transform", expanded[r.id] && "rotate-90")} />
        </button>
      ),
    },
  ];

  const diffRenderer = (r: AuditEntry) =>
    expanded[r.id] ? (
      <div className="grid grid-cols-2 gap-3 p-3 bg-paper/50 rounded-md text-xs font-mono">
        <div>
          <div className="text-muted mb-1">before</div>
          <pre className="whitespace-pre-wrap break-all">{JSON.stringify(r.before, null, 2)}</pre>
        </div>
        <div>
          <div className="text-muted mb-1">after</div>
          <pre className="whitespace-pre-wrap break-all">{JSON.stringify(r.after, null, 2)}</pre>
        </div>
      </div>
    ) : null;

  return (
    <div className="space-y-4">
      <AuditFilters value={filter} onChange={setFilter} actors={actors} />
      <DataTable<AuditEntry>
        rows={filtered}
        columns={columns}
        rowKey={(r) => r.id}
        pageSize={20}
        empty={
          <EmptyState
            title="No audit entries match"
            description="Try loosening the filters or clearing the date range."
          />
        }
      />
      {filtered.some((r) => expanded[r.id]) && (
        <div className="space-y-3">
          {filtered.filter((r) => expanded[r.id]).map((r) => (
            <div key={`d-${r.id}`} className="rounded-lg border border-border bg-card p-2">
              <div className="px-2 py-1 text-xs text-muted">
                {formatDateTime(r.ts)} · {actorName(r.actorId)} · {r.action} · {r.entityId}
              </div>
              {diffRenderer(r)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function actionTone(action: string): "neutral" | "accent" | "sage" | "warning" | "error" | "cyan" {
  if (action.startsWith("credit") || action.startsWith("package")) return "accent";
  if (action.startsWith("invoice") || action.startsWith("booking.cancel")) return "warning";
  if (action.includes("suspend") || action.endsWith("disable") || action.endsWith("softDelete")) return "error";
  if (action.startsWith("private")) return "cyan";
  if (action.startsWith("tenant") || action.startsWith("featureFlag")) return "sage";
  return "neutral";
}
