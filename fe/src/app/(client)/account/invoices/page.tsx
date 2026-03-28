"use client";

import { motion } from "framer-motion";
import { formatDate, formatCurrency } from "@/lib/utils";
import { StatusBadge } from "@/components/status-badge";
import { EmptyState } from "@/components/empty-state";
import type { Invoice } from "@/types";
import invoicesData from "@/data/invoices.json";

const CLIENT_ID = "cli-1";

const invoices = invoicesData as Invoice[];

const fadeUp = {
  hidden: { opacity: 0, y: 20 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.06, duration: 0.5, ease: [0.22, 1, 0.36, 1] as const },
  }),
};

export default function InvoicesPage() {
  const myInvoices = invoices
    .filter((inv) => inv.clientId === CLIENT_ID)
    .sort(
      (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
    );

  if (myInvoices.length === 0) {
    return (
      <EmptyState
        icon="🧾"
        title="No invoices yet"
        description="Your payment history will appear here after your first purchase."
      />
    );
  }

  return (
    <div>
      <motion.h2
        initial="hidden"
        animate="visible"
        custom={0}
        variants={fadeUp}
        className="font-serif text-xl text-ink mb-6"
      >
        Invoices
      </motion.h2>

      {/* Desktop table */}
      <div className="hidden sm:block">
        <motion.div
          initial="hidden"
          animate="visible"
          custom={1}
          variants={fadeUp}
          className="bg-card border border-border rounded-lg overflow-hidden"
        >
          <table className="w-full">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left text-xs text-muted font-medium uppercase tracking-wide px-5 py-3">
                  Invoice #
                </th>
                <th className="text-left text-xs text-muted font-medium uppercase tracking-wide px-5 py-3">
                  Date
                </th>
                <th className="text-left text-xs text-muted font-medium uppercase tracking-wide px-5 py-3">
                  Description
                </th>
                <th className="text-right text-xs text-muted font-medium uppercase tracking-wide px-5 py-3">
                  Amount
                </th>
                <th className="text-left text-xs text-muted font-medium uppercase tracking-wide px-5 py-3">
                  Status
                </th>
                <th className="text-right text-xs text-muted font-medium uppercase tracking-wide px-5 py-3">
                  &nbsp;
                </th>
              </tr>
            </thead>
            <tbody>
              {myInvoices.map((invoice, i) => (
                <motion.tr
                  key={invoice.id}
                  initial="hidden"
                  animate="visible"
                  custom={2 + i}
                  variants={fadeUp}
                  className="border-b border-border last:border-0 hover:bg-warm/50 transition-colors duration-150"
                >
                  <td className="px-5 py-4">
                    <span className="text-sm font-mono text-ink">
                      {invoice.invoiceNumber}
                    </span>
                  </td>
                  <td className="px-5 py-4">
                    <span className="text-sm text-muted">
                      {formatDate(invoice.date)}
                    </span>
                  </td>
                  <td className="px-5 py-4">
                    <span className="text-sm text-ink">
                      {invoice.items[0]?.description ?? "—"}
                    </span>
                  </td>
                  <td className="px-5 py-4 text-right">
                    <span className="text-sm font-medium text-ink">
                      {formatCurrency(invoice.amount)}
                    </span>
                  </td>
                  <td className="px-5 py-4">
                    <StatusBadge status={invoice.status} />
                  </td>
                  <td className="px-5 py-4 text-right">
                    <button className="text-xs text-accent-deep hover:text-accent font-medium transition-colors duration-200">
                      Download PDF
                    </button>
                  </td>
                </motion.tr>
              ))}
            </tbody>
          </table>
        </motion.div>
      </div>

      {/* Mobile cards */}
      <div className="sm:hidden space-y-3">
        {myInvoices.map((invoice, i) => (
          <motion.div
            key={invoice.id}
            initial="hidden"
            animate="visible"
            custom={2 + i}
            variants={fadeUp}
            className="bg-card border border-border rounded-lg p-4"
          >
            <div className="flex items-start justify-between gap-3 mb-2">
              <div>
                <span className="text-sm font-mono text-ink block">
                  {invoice.invoiceNumber}
                </span>
                <span className="text-xs text-muted">
                  {formatDate(invoice.date)}
                </span>
              </div>
              <StatusBadge status={invoice.status} />
            </div>
            <p className="text-sm text-ink mb-2">
              {invoice.items[0]?.description ?? "—"}
            </p>
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-ink">
                {formatCurrency(invoice.amount)}
              </span>
              <button className="text-xs text-accent-deep hover:text-accent font-medium transition-colors duration-200">
                Download PDF
              </button>
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  );
}
