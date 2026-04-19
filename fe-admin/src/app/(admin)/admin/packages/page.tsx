"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { useAdminState } from "@/lib/admin-state";
import { useWithTenant } from "@/lib/tenant-scope";
import { PageHeader, Button, Badge, EmptyState, Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui";
import { DataTable, type DataTableColumn } from "@/components/data-table";
import { formatCurrency } from "@/lib/formatters";
import { archiveProduct } from "@/lib/mutations/products";
import { toast } from "sonner";
import type { Product } from "@/types";

const TYPES: { value: Product["type"]; label: string }[] = [
  { value: "drop-in", label: "Drop-in" },
  { value: "package", label: "Packages" },
  { value: "membership", label: "Memberships" },
  { value: "vip", label: "VIP" },
];

export default function ProductsPage() {
  const products = useWithTenant(useAdminState((s) => s.products));
  const [tab, setTab] = useState<Product["type"]>("package");

  const tabbed = useMemo(() => {
    const grouped = new Map<Product["type"], Product[]>();
    for (const t of TYPES) grouped.set(t.value, []);
    for (const p of products) {
      const arr = grouped.get(p.type) ?? [];
      arr.push(p);
      grouped.set(p.type, arr);
    }
    return grouped;
  }, [products]);

  const columns: DataTableColumn<Product>[] = [
    {
      key: "name",
      header: "Name",
      sortable: true,
      sortValue: (p) => p.name,
      cell: (p) => (
        <Link href={`/admin/packages/${p.id}`} className="font-medium text-ink hover:text-accent">
          {p.name}
        </Link>
      ),
    },
    {
      key: "credit",
      header: "Credit",
      cell: (p) => <Badge tone="neutral">{p.creditType}</Badge>,
    },
    {
      key: "sessions",
      header: "Sessions",
      align: "right",
      cell: (p) => (
        <span className="text-sm tabular-nums text-muted">
          {p.sessionCount ?? p.sessionsPerMonth ?? "âˆž"}
        </span>
      ),
    },
    {
      key: "expiry",
      header: "Expiry",
      align: "right",
      cell: (p) => (
        <span className="text-sm tabular-nums text-muted">
          {p.expiryDays ? `${p.expiryDays}d` : "â€”"}
        </span>
      ),
    },
    {
      key: "price",
      header: "Price",
      align: "right",
      cell: (p) => <span className="text-sm tabular-nums">{formatCurrency(p.priceCents)}</span>,
    },
    {
      key: "active",
      header: "",
      cell: (p) =>
        p.active ? <Badge tone="sage">Active</Badge> : <Badge tone="neutral">Archived</Badge>,
    },
    {
      key: "actions",
      header: "",
      align: "right",
      cell: (p) => (
        <button
          type="button"
          onClick={() => {
            const note = window.prompt("Audit note (why archive?)");
            if (!note) return;
            try {
              archiveProduct(p.id, note);
              toast.success("Archived");
            } catch (err) {
              toast.error(err instanceof Error ? err.message : "Failed");
            }
          }}
          disabled={!p.active}
          className="text-xs text-muted hover:text-error disabled:opacity-30"
        >
          Archive
        </button>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Packages"
        description="Drop-ins, packages, memberships, and VIP passes."
        actions={
          <Link href="/admin/packages/new">
            <Button>
              <Plus className="mr-1 h-4 w-4" /> New package
            </Button>
          </Link>
        }
      />
      <div className="mt-6">
        <Tabs value={tab} onValueChange={(v) => setTab(v as Product["type"])}>
          <TabsList>
            {TYPES.map((t) => (
              <TabsTrigger key={t.value} value={t.value}>
                {t.label} <span className="ml-1 text-xs text-muted">({tabbed.get(t.value)?.length ?? 0})</span>
              </TabsTrigger>
            ))}
          </TabsList>
          {TYPES.map((t) => (
            <TabsContent key={t.value} value={t.value}>
              <DataTable<Product>
                rows={tabbed.get(t.value) ?? []}
                columns={columns}
                rowKey={(p) => p.id}
                empty={
                  <EmptyState
                    title={`No ${t.label.toLowerCase()} yet`}
                    description="Create one to make it available to clients."
                    cta={{ href: "/admin/packages/new", label: "Create package" }}
                  />
                }
              />
            </TabsContent>
          ))}
        </Tabs>
      </div>
    </>
  );
}
