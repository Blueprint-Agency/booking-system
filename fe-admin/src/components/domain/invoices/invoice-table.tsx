"use client";

import Link from "next/link";
import { useMemo } from "react";
import { Download } from "lucide-react";
import { useAdminState } from "@/lib/admin-state";
import { useWithTenant } from "@/lib/tenant-scope";
import { Button, EmptyState, StatusBadge } from "@/components/ui";
import { DataTable, type DataTableColumn } from "@/components/data-table";
import { exportInvoicesCsv } from "@/lib/mutations/invoices";
import { formatCurrency } from "@/lib/formatters";
import type { Invoice } from "@/types";

function downloadCsv(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 0);
}

export function InvoiceTable() {
  const invoices = useWithTenant(useAdminState((s) => s.invoices));
  const clients = useAdminState((s) => s.clients);
  const clientById = useMemo(() => new Map(clients.map((c) => [c.id, c.name])), [clients]);

  const columns: DataTableColumn<Invoice>[] = [
    {
      key: "number",
      header: "Invoice",
      sortable: true,
      sortValue: (i) => i.invoiceNumber,
      cell: (i) => (
        <Link href={`/admin/invoices/${i.id}`} className="font-mono text-sm font-semibold text-ink hover:text-accent">
          {i.invoiceNumber}
        </Link>
      ),
    },
    {
      key: "issued",
      header: "Issued",
      sortable: true,
      sortValue: (i) => i.issuedAt,
      cell: (i) => (
        <span className="text-sm text-muted">
          {new Date(i.issuedAt).toLocaleDateString()}
        </span>
      ),
    },
    {
      key: "client",
      header: "Client",
      cell: (i) => (
        <Link href={`/admin/clients/${i.clientId}`} className="text-sm text-ink hover:text-accent">
          {clientById.get(i.clientId) ?? i.clientId}
        </Link>
      ),
    },
    {
      key: "amount",
      header: "Total",
      align: "right",
      cell: (i) => <span className="text-sm tabular-nums">{formatCurrency(i.amountCents)}</span>,
    },
    {
      key: "method",
      header: "Method",
      cell: (i) => <span className="text-xs text-muted capitalize">{i.paymentMethod}</span>,
    },
    {
      key: "status",
      header: "Status",
      cell: (i) => <StatusBadge status={i.status} />,
    },
  ];

  return (
    <DataTable<Invoice>
      rows={invoices}
      columns={columns}
      rowKey={(i) => i.id}
      empty={<EmptyState title="No invoices" description="No invoices in your tenant." />}
      filters={
        <Button
          type="button"
          variant="ghost"
          onClick={() => {
            const today = new Date().toISOString().slice(0, 10);
            const todays = invoices.filter((i) => i.issuedAt.startsWith(today));
            const csv = exportInvoicesCsv(todays.length ? todays : invoices, clientById);
            downloadCsv(`invoices-${today}.csv`, csv);
          }}
        >
          <Download className="mr-1 h-4 w-4" /> Export CSV
        </Button>
      }
    />
  );
}
