"use client";

import { useMemo } from "react";
import { useParams } from "next/navigation";
import { useAdminState } from "@/lib/admin-state";
import { formatDate, formatCurrency } from "@/lib/formatters";
import { DataTable, type DataTableColumn } from "@/components/data-table";
import { StatusBadge, EmptyState } from "@/components/ui";
import type { Invoice } from "@/types";

export default function ClientInvoicesPage() {
  const { id } = useParams<{ id: string }>();
  const allInvoices = useAdminState((s) => s.invoices);
  const invoices = useMemo(
    () => allInvoices.filter((i) => i.clientId === id),
    [allInvoices, id],
  );

  const columns: DataTableColumn<Invoice>[] = [
    { key: "number", header: "Number", cell: (i) => <span className="font-mono text-sm">{i.invoiceNumber}</span> },
    {
      key: "issued",
      header: "Issued",
      sortable: true,
      sortValue: (i) => i.issuedAt,
      cell: (i) => <span className="text-sm">{formatDate(i.issuedAt)}</span>,
    },
    {
      key: "amount",
      header: "Amount",
      sortable: true,
      sortValue: (i) => i.amountCents,
      align: "right",
      cell: (i) => <span>{formatCurrency(i.amountCents)}</span>,
    },
    {
      key: "status",
      header: "Status",
      cell: (i) => <StatusBadge status={i.status} />,
    },
    {
      key: "method",
      header: "Method",
      cell: (i) => <span className="text-sm text-muted">{i.paymentMethod}</span>,
    },
  ];

  return (
    <DataTable<Invoice>
      rows={invoices}
      columns={columns}
      rowKey={(i) => i.id}
      pageSize={20}
      empty={<EmptyState title="No invoices" description="Invoices appear here after purchase or renewal." />}
    />
  );
}
