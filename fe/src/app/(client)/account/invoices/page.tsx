"use client";

import { FileX } from "lucide-react";
import { formatDate, formatCurrency } from "@/lib/utils";
import { SectionHeading } from "@/components/booking/section-heading";
import { EmptyState } from "@/components/ui/empty-state";
import type { Invoice } from "@/types";
import invoicesData from "@/data/invoices.json";

const CLIENT_ID = "cli-1";

const invoices = invoicesData as Invoice[];

export default function InvoicesPage() {
  const myInvoices = invoices
    .filter((inv) => inv.clientId === CLIENT_ID)
    .sort(
      (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
    );

  return (
    <div>
      <SectionHeading
        eyebrow="Invoices"
        title="Payment records"
        description="Download receipts for your tax records."
      />

      <div className="rounded-2xl bg-paper border border-ink/10 overflow-hidden">
        {myInvoices.length === 0 ? (
          <EmptyState
            icon={FileX}
            title="No invoices yet"
            description="Receipts will appear here after your first payment."
          />
        ) : (
          <ul className="divide-y divide-ink/5">
            {myInvoices.map((invoice) => (
              <li
                key={invoice.id}
                className="flex items-center justify-between px-6 py-4"
              >
                <div>
                  <div className="text-sm font-medium text-ink">
                    {formatDate(invoice.date)}
                  </div>
                  <div className="text-xs text-muted mt-0.5">
                    {invoice.invoiceNumber}
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <span className="text-sm font-semibold text-ink">
                    {formatCurrency(invoice.amount)}
                  </span>
                  <button className="rounded-full border border-ink/10 px-4 py-2 text-xs font-medium hover:border-accent transition-colors">
                    Download PDF
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
