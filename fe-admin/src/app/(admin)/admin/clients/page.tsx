"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Users } from "lucide-react";
import { useAdminState } from "@/lib/admin-state";
import { useCurrentTenantId } from "@/lib/admin-auth";
import { withTenant } from "@/lib/tenant-scope";
import { formatRelative } from "@/lib/formatters";
import { PageHeader, Avatar, EmptyState, Button } from "@/components/ui";
import { DataTable, type DataTableColumn } from "@/components/data-table";
import {
  ClientFilters,
  EMPTY_CLIENT_FILTER,
  applyClientFilter,
  type ClientFilterValue,
} from "@/components/domain/clients/client-filters";
import type { Client, ClientPackage } from "@/types";

export default function ClientsPage() {
  const clients = useAdminState((s) => s.clients);
  const packages = useAdminState((s) => s.clientPackages);
  const products = useAdminState((s) => s.products);
  const tid = useCurrentTenantId();
  const [filter, setFilter] = useState<ClientFilterValue>(EMPTY_CLIENT_FILTER);

  const scopedClients = useMemo(() => withTenant(clients, tid), [clients, tid]);
  const tenantLocations = useAdminState((s) => s.locations);
  const scopedLocations = useMemo(() => withTenant(tenantLocations, tid), [tenantLocations, tid]);
  const scopedProducts = useMemo(() => withTenant(products, tid), [products, tid]);

  const filtered = useMemo(
    () => applyClientFilter(scopedClients, packages, filter),
    [scopedClients, packages, filter],
  );

  const productNameById = useMemo(() => {
    const m = new Map<string, string>();
    products.forEach((p) => m.set(p.id, p.name));
    return m;
  }, [products]);

  const pkgByClient = useMemo(() => {
    const map = new Map<string, ClientPackage | undefined>();
    packages.forEach((p) => {
      if (p.status !== "active") return;
      const existing = map.get(p.clientId);
      if (!existing || (p.expiresAt ?? "") > (existing.expiresAt ?? "")) map.set(p.clientId, p);
    });
    return map;
  }, [packages]);

  const columns: DataTableColumn<Client>[] = [
    {
      key: "name",
      header: "Client",
      sortable: true,
      sortValue: (c) => c.name,
      cell: (c) => (
        <div className="flex items-center gap-3">
          <Avatar name={c.name} />
          <div className="flex flex-col">
            <Link
              href={`/admin/clients/${c.id}`}
              className="font-medium text-ink hover:text-accent"
              onClick={(e) => e.stopPropagation()}
            >
              {c.name}
            </Link>
            <span className="text-xs text-muted">{c.email}</span>
          </div>
        </div>
      ),
    },
    { key: "phone", header: "Phone", cell: (c) => <span className="text-sm">{c.phone}</span> },
    {
      key: "lastVisit",
      header: "Last visit",
      sortable: true,
      sortValue: (c) => c.lastVisit ?? "",
      cell: (c) =>
        c.lastVisit ? (
          <span className="text-sm">{formatRelative(c.lastVisit)}</span>
        ) : (
          <span className="text-xs text-muted">never</span>
        ),
    },
    {
      key: "noShow",
      header: "No-shows",
      sortable: true,
      sortValue: (c) => c.noShowCount,
      align: "right",
      cell: (c) => (
        <span className={c.noShowCount >= 3 ? "text-error font-medium" : "text-muted"}>
          {c.noShowCount}
        </span>
      ),
    },
    {
      key: "package",
      header: "Active package",
      cell: (c) => {
        const p = pkgByClient.get(c.id);
        if (!p) return <span className="text-xs text-muted">none</span>;
        const name = productNameById.get(p.productId) ?? "Package";
        return (
          <div className="flex flex-col">
            <span className="text-sm text-ink">{name}</span>
            <span className="text-xs text-muted">
              {p.sessionsRemaining}/{p.sessionsTotal} credits
            </span>
          </div>
        );
      },
    },
  ];

  return (
    <>
      <PageHeader
        title="Clients"
        description={`${filtered.length} of ${scopedClients.length} shown`}
        actions={
          <Button variant="primary" disabled>
            New client
          </Button>
        }
      />
      <div className="mt-6 space-y-4">
        <ClientFilters
          value={filter}
          onChange={setFilter}
          locations={scopedLocations}
          products={scopedProducts}
          packages={packages}
        />
        <DataTable<Client>
          rows={filtered}
          columns={columns}
          rowKey={(c) => c.id}
          pageSize={20}
          empty={
            <EmptyState
              icon={Users}
              title="No clients match these filters"
              description="Loosen the filters or clear them to see the full roster."
              cta={
                <Button variant="secondary" onClick={() => setFilter(EMPTY_CLIENT_FILTER)}>
                  Clear filters
                </Button>
              }
            />
          }
        />
      </div>
    </>
  );
}
