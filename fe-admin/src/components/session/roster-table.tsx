"use client";

import type { Booking, Client, ClientPackage, Product } from "@/types";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cancelBooking, markNoShow } from "@/lib/mock-state";

function statusTone(s: Booking["checkInStatus"]): "sage" | "error" | "warning" | "neutral" {
  switch (s) {
    case "attended":
      return "sage";
    case "no-show":
      return "error";
    case "late":
      return "warning";
    default:
      return "neutral";
  }
}

export function RosterTable({
  bookings,
  clients,
  clientPackages,
  products,
}: {
  bookings: Booking[];
  clients: Client[];
  clientPackages: ClientPackage[];
  products: Product[];
}) {
  if (bookings.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-ink/15 bg-paper/40 p-8 text-center text-sm text-ink/60">
        No bookings yet. Use <span className="font-semibold">Manual book</span> to add a client.
      </div>
    );
  }
  return (
    <div className="overflow-hidden rounded-xl border border-ink/10 bg-white">
      <table className="w-full text-sm">
        <thead className="bg-paper/60 text-left text-[11px] font-semibold uppercase tracking-wide text-ink/60">
          <tr>
            <th className="px-4 py-2">Client</th>
            <th className="px-4 py-2">Package used</th>
            <th className="px-4 py-2">Credit cost</th>
            <th className="px-4 py-2">Status</th>
            <th className="px-4 py-2 text-right">Actions</th>
          </tr>
        </thead>
        <tbody>
          {bookings.map((b) => {
            const client = clients.find((c) => c.id === b.clientId);
            const pkg = clientPackages.find((p) => p.id === b.packageId);
            const product = pkg ? products.find((p) => p.id === pkg.productId) : null;
            return (
              <tr key={b.id} className="border-t border-ink/5">
                <td className="px-4 py-3">
                  <div className="font-medium text-ink">
                    {client ? `${client.firstName} ${client.lastName}` : "Unknown"}
                  </div>
                  <div className="text-xs text-ink/50">{client?.email ?? ""}</div>
                </td>
                <td className="px-4 py-3 text-ink/70">{product?.name ?? "—"}</td>
                <td className="px-4 py-3 font-mono text-ink/70">{b.packageId ? "1" : "—"}</td>
                <td className="px-4 py-3">
                  {b.status === "cancelled" ? (
                    <Badge tone="neutral">cancelled</Badge>
                  ) : (
                    <Badge tone={statusTone(b.checkInStatus)}>{b.checkInStatus}</Badge>
                  )}
                </td>
                <td className="px-4 py-3 text-right">
                  {b.status === "confirmed" && b.checkInStatus === "pending" && (
                    <>
                      <Button variant="ghost" size="sm" onClick={() => markNoShow(b.id)}>
                        No-show
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => cancelBooking(b.id)}>
                        Cancel
                      </Button>
                    </>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
