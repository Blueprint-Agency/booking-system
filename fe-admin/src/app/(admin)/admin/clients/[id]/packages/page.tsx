"use client";

import { useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { useAdminState } from "@/lib/admin-state";
import { formatDate } from "@/lib/formatters";
import { DataTable, type DataTableColumn } from "@/components/data-table";
import { Badge, EmptyState, Button } from "@/components/ui";
import { PackageAdjustDialog } from "@/components/domain/clients/package-adjust-dialog";
import type { ClientPackage } from "@/types";

export default function ClientPackagesPage() {
  const { id } = useParams<{ id: string }>();
  const allPackages = useAdminState((s) => s.clientPackages);
  const products = useAdminState((s) => s.products);
  const packages = useMemo(
    () => allPackages.filter((p) => p.clientId === id),
    [allPackages, id],
  );
  const [adjusting, setAdjusting] = useState<ClientPackage | null>(null);

  const columns: DataTableColumn<ClientPackage>[] = [
    {
      key: "product",
      header: "Product",
      cell: (p) => {
        const prod = products.find((pr) => pr.id === p.productId);
        return <span className="font-medium text-ink">{prod?.name ?? p.productId}</span>;
      },
    },
    {
      key: "sessions",
      header: "Sessions",
      cell: (p) => (
        <span>
          {p.sessionsRemaining} / {p.sessionsTotal}
        </span>
      ),
    },
    {
      key: "purchased",
      header: "Purchased",
      sortable: true,
      sortValue: (p) => p.purchasedAt,
      cell: (p) => <span className="text-sm">{formatDate(p.purchasedAt)}</span>,
    },
    {
      key: "expires",
      header: "Expires",
      cell: (p) => (
        <span className="text-sm">{p.expiresAt ? formatDate(p.expiresAt) : "—"}</span>
      ),
    },
    {
      key: "status",
      header: "Status",
      cell: (p) => (
        <Badge
          tone={
            p.status === "active"
              ? "sage"
              : p.status === "paused"
                ? "warning"
                : p.status === "cancelled"
                  ? "error"
                  : "neutral"
          }
        >
          {p.status}
        </Badge>
      ),
    },
  ];

  return (
    <>
      <DataTable<ClientPackage>
        rows={packages}
        columns={columns}
        rowKey={(p) => p.id}
        pageSize={20}
        actions={(p) => (
          <Button variant="ghost" size="sm" onClick={() => setAdjusting(p)}>
            Adjust
          </Button>
        )}
        empty={
          <EmptyState
            title="No packages"
            description="Grant credits or sell a package to see rows here."
          />
        }
      />
      {adjusting && (
        <PackageAdjustDialog
          pkg={adjusting}
          open={true}
          onOpenChange={(o) => !o && setAdjusting(null)}
        />
      )}
    </>
  );
}
