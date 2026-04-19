"use client";

import Link from "next/link";
import { useMemo } from "react";
import { Plus } from "lucide-react";
import { useAdminState } from "@/lib/admin-state";
import { PageHeader, Button, Badge, EmptyState } from "@/components/ui";
import { DataTable, type DataTableColumn } from "@/components/data-table";
import { formatRRule, parseRRule } from "@/lib/rrule";
import type { SessionTemplate } from "@/types";

function summarize(rrule: string | null): string {
  if (!rrule) return "â€”";
  try {
    return formatRRule(parseRRule(rrule));
  } catch {
    return rrule;
  }
}

export default function ClassesPage() {
  const templates = useAdminState((s) => s.sessionTemplates);
  const instructors = useAdminState((s) => s.instructors);
  const products = useAdminState((s) => s.products);

  const instructorById = useMemo(
    () => new Map(instructors.map((i) => [i.id, i])),
    [instructors],
  );

  const creditTypeLabel: Record<string, string> = useMemo(() => {
    const map: Record<string, string> = {};
    for (const p of products) {
      if (!map[p.creditType]) map[p.creditType] = p.category ?? p.creditType;
    }
    return map;
  }, [products]);

  const columns: DataTableColumn<SessionTemplate>[] = [
    {
      key: "name",
      header: "Class",
      sortable: true,
      sortValue: (t) => t.name,
      cell: (t) => (
        <Link href={`/admin/classes/${t.id}`} className="font-medium text-ink hover:text-accent">
          {t.name}
        </Link>
      ),
    },
    {
      key: "category",
      header: "Category",
      cell: (t) => <span className="text-sm text-muted">{t.category}</span>,
    },
    {
      key: "package",
      header: "Package type",
      cell: (t) => {
        const ct = t.creditType ?? "class";
        const label = creditTypeLabel[ct] ?? "Class Credits";
        return <Badge tone="neutral">{label}</Badge>;
      },
    },
    {
      key: "level",
      header: "Level",
      cell: (t) => (
        <Badge tone={t.level === "advanced" ? "warning" : "neutral"}>{t.level}</Badge>
      ),
    },
    {
      key: "duration",
      header: "Duration",
      align: "right",
      cell: (t) => <span className="text-sm tabular-nums">{t.duration} min</span>,
    },
    {
      key: "price",
      header: "Price",
      align: "right",
      cell: (t) => (
        <span className="text-sm tabular-nums">SGD {(t.defaultPriceCents / 100).toFixed(2)}</span>
      ),
    },
    {
      key: "instructor",
      header: "Instructor",
      cell: (t) => (
        <span className="text-sm text-muted">
          {t.defaultInstructorId ? instructorById.get(t.defaultInstructorId)?.name ?? "â€”" : "â€”"}
        </span>
      ),
    },
    {
      key: "recurrence",
      header: "Recurrence",
      cell: (t) => <span className="text-xs text-muted">{summarize(t.recurrence)}</span>,
    },
    {
      key: "eligible",
      header: "",
      cell: (t) =>
        t.packageEligible ? (
          <Badge tone="sage">Package OK</Badge>
        ) : (
          <Badge tone="neutral">Drop-in only</Badge>
        ),
    },
    {
      key: "active",
      header: "",
      cell: (t) =>
        t.active ? <Badge tone="sage">Active</Badge> : <Badge tone="neutral">Archived</Badge>,
    },
  ];

  return (
    <>
      <PageHeader
        title="Classes"
        description="Recurring class templates expand into the schedule for the next 14 days."
        actions={
          <Link href="/admin/classes/new">
            <Button>
              <Plus className="mr-1 h-4 w-4" /> New class
            </Button>
          </Link>
        }
      />
      <div className="mt-6">
        <DataTable<SessionTemplate>
          rows={templates}
          columns={columns}
          rowKey={(t) => t.id}
          empty={
            <EmptyState
              title="No class templates yet"
              description="Create a recurring class template to populate the schedule."
              cta={{ href: "/admin/classes/new", label: "Create template" }}
            />
          }
        />
      </div>
    </>
  );
}
