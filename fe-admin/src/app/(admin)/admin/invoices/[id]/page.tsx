"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { useAdminState } from "@/lib/admin-state";
import { PageHeader, Badge, StatusBadge, EmptyState } from "@/components/ui";
import { formatCurrency, formatDateTime } from "@/lib/formatters";

export default function InvoiceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const invoice = useAdminState((s) => s.invoices.find((x) => x.id === id));
  const client = useAdminState((s) =>
    invoice ? s.clients.find((c) => c.id === invoice.clientId) : undefined,
  );

  if (!invoice) {
    return (
      <EmptyState
        title="Invoice not found"
        cta={{ href: "/admin/invoices", label: "Back to invoices" }}
      />
    );
  }

  const refundedTotal = invoice.items
    .filter((it) => it.refunded)
    .reduce((sum, it) => sum + it.amountCents, 0);

  return (
    <>
      <div className="mb-3 text-xs text-muted">
        <Link href="/admin/invoices" className="inline-flex items-center gap-1 hover:text-ink">
          <ArrowLeft className="h-3 w-3" /> Invoices
        </Link>
      </div>
      <PageHeader
        title={invoice.invoiceNumber}
        description={`Issued ${formatDateTime(invoice.issuedAt)} · ${invoice.paymentMethod}`}
        actions={<StatusBadge status={invoice.status} />}
      />
      <div className="mt-2 rounded-md border border-border bg-paper/40 px-3 py-2 text-xs text-muted">
        Refunds are settled out-of-app. See <Link href="/admin/refunds" className="text-accent hover:underline">/refunds</Link> for the request inbox.
      </div>

      <div className="mt-6 grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="rounded-lg border border-border bg-card p-5 lg:col-span-2">
          <h3 className="mb-3 text-sm font-semibold text-ink">Line items</h3>
          <table className="w-full text-sm">
            <thead className="border-b border-border text-xs uppercase text-muted">
              <tr>
                <th className="py-2 text-left font-medium">Description</th>
                <th className="py-2 text-right font-medium">Qty</th>
                <th className="py-2 text-right font-medium">Unit</th>
                <th className="py-2 text-right font-medium">Total</th>
                <th className="py-2 text-right font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {invoice.items.map((it) => (
                <tr key={it.id} className="border-b border-border last:border-0">
                  <td className="py-2 text-ink">{it.description}</td>
                  <td className="py-2 text-right tabular-nums">{it.quantity}</td>
                  <td className="py-2 text-right tabular-nums text-muted">
                    {formatCurrency(it.unitPriceCents)}
                  </td>
                  <td className="py-2 text-right tabular-nums">
                    {formatCurrency(it.amountCents)}
                  </td>
                  <td className="py-2 text-right">
                    {it.refunded && <Badge tone="error">Refunded</Badge>}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t border-border">
              <tr>
                <td colSpan={3} className="pt-3 text-right text-xs uppercase text-muted">
                  Total
                </td>
                <td className="pt-3 text-right text-base font-semibold tabular-nums text-ink">
                  {formatCurrency(invoice.amountCents)}
                </td>
                <td />
              </tr>
              {refundedTotal > 0 && (
                <tr>
                  <td colSpan={3} className="text-right text-xs uppercase text-muted">
                    Refunded
                  </td>
                  <td className="text-right tabular-nums text-error">
                    -{formatCurrency(refundedTotal)}
                  </td>
                  <td />
                </tr>
              )}
            </tfoot>
          </table>
        </div>
        <div className="space-y-4">
          <div className="rounded-lg border border-border bg-card p-5">
            <h3 className="mb-3 text-sm font-semibold text-ink">Client</h3>
            {client ? (
              <Link href={`/admin/clients/${client.id}`} className="block hover:text-accent">
                <div className="font-medium text-ink">{client.name}</div>
                <div className="text-xs text-muted">{client.email}</div>
                <div className="text-xs text-muted">{client.phone}</div>
              </Link>
            ) : (
              <span className="text-sm text-muted">Unknown</span>
            )}
          </div>
        </div>
      </div>

    </>
  );
}
