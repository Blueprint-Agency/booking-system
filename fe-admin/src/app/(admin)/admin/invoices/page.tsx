"use client";

import { PageHeader } from "@/components/ui";
import { InvoiceTable } from "@/components/domain/invoices/invoice-table";

export default function InvoicesPage() {
  return (
    <>
      <PageHeader
        title="Invoices"
        description="Every issued invoice with status, line items, and refund history."
      />
      <div className="mt-6">
        <InvoiceTable />
      </div>
    </>
  );
}
