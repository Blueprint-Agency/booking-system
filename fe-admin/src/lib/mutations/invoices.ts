"use client";

import type { Invoice } from "@/types";

export function exportInvoicesCsv(invoices: Invoice[], clientNameById: Map<string, string>): string {
  const header = [
    "invoice",
    "issued",
    "client",
    "status",
    "method",
    "total_cents",
    "lines",
    "refunded_cents",
  ].join(",");

  const rows = invoices.map((inv) => {
    const refunded = inv.items
      .filter((it) => it.refunded)
      .reduce((sum, it) => sum + it.amountCents, 0);
    const cells = [
      inv.invoiceNumber,
      inv.issuedAt,
      JSON.stringify(clientNameById.get(inv.clientId) ?? inv.clientId),
      inv.status,
      inv.paymentMethod,
      String(inv.amountCents),
      String(inv.items.length),
      String(refunded),
    ];
    return cells.join(",");
  });
  return [header, ...rows].join("\n");
}
