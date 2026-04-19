"use client";

import Link from "next/link";
import { Plus } from "lucide-react";
import { useAdminState } from "@/lib/admin-state";
import { useWithTenant } from "@/lib/tenant-scope";
import { PageHeader, Button, Badge, EmptyState } from "@/components/ui";
import { DataTable, type DataTableColumn } from "@/components/data-table";
import { formatCurrency } from "@/lib/formatters";
import type { Promo } from "@/types";

function statusOf(p: Promo): { tone: "sage" | "neutral" | "warning" | "error"; label: string } {
  if (!p.active) return { tone: "neutral", label: "Disabled" };
  const now = Date.now();
  if (Date.parse(p.endsAt) < now) return { tone: "error", label: "Expired" };
  if (Date.parse(p.startsAt) > now) return { tone: "warning", label: "Scheduled" };
  if (p.usedCount >= p.usageCap) return { tone: "warning", label: "Capped" };
  return { tone: "sage", label: "Live" };
}

export default function PromosPage() {
  const promos = useWithTenant(useAdminState((s) => s.promos));

  const columns: DataTableColumn<Promo>[] = [
    {
      key: "code",
      header: "Code",
      sortable: true,
      sortValue: (p) => p.code,
      cell: (p) => (
        <Link href={`/admin/promos/${p.id}`} className="font-mono text-sm font-semibold text-ink hover:text-accent">
          {p.code}
        </Link>
      ),
    },
    {
      key: "discount",
      header: "Discount",
      cell: (p) => (
        <span className="text-sm text-ink">
          {p.discountType === "amount"
            ? formatCurrency(p.discountValue)
            : `${p.discountValue}%`}
        </span>
      ),
    },
    {
      key: "window",
      header: "Window",
      cell: (p) => (
        <span className="text-xs text-muted">
          {new Date(p.startsAt).toLocaleDateString()} â€“ {new Date(p.endsAt).toLocaleDateString()}
        </span>
      ),
    },
    {
      key: "usage",
      header: "Usage",
      align: "right",
      cell: (p) => (
        <span className="text-sm tabular-nums text-muted">
          {p.usedCount}/{p.usageCap}
        </span>
      ),
    },
    {
      key: "products",
      header: "Products",
      cell: (p) => (
        <span className="text-xs text-muted">
          {p.productIds.length === 0 ? "All" : `${p.productIds.length} selected`}
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      cell: (p) => {
        const s = statusOf(p);
        return <Badge tone={s.tone}>{s.label}</Badge>;
      },
    },
  ];

  return (
    <>
      <PageHeader
        title="Promos"
        description="Discount codes with usage caps and date windows."
        actions={
          <Link href="/admin/promos/new">
            <Button>
              <Plus className="mr-1 h-4 w-4" /> New promo
            </Button>
          </Link>
        }
      />
      <div className="mt-6">
        <DataTable<Promo>
          rows={promos}
          columns={columns}
          rowKey={(p) => p.id}
          empty={
            <EmptyState
              title="No promos yet"
              description="Create your first discount code."
              cta={{ href: "/admin/promos/new", label: "Create promo" }}
            />
          }
        />
      </div>
    </>
  );
}
