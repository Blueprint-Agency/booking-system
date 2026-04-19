"use client";

import { useState } from "react";
import { PageHeader } from "@/components/ui/page-header";
import { ScannerSim } from "@/components/check-in/scanner-sim";
import { ManualInput } from "@/components/check-in/manual-input";
import { RecentCheckIns } from "@/components/check-in/recent-check-ins";
import { Card } from "@/components/ui/card";
import { useAdminState, checkInByBookingId } from "@/lib/mock-state";
import clientsData from "@/data/clients.json";
import type { Client } from "@/types";

const TODAY = "2026-04-20";

export default function CheckInPage() {
  const state = useAdminState();
  const clients = clientsData as Client[];
  const [flash, setFlash] = useState<{ kind: "ok" | "err"; msg: string } | null>(null);

  const todaySessionIds = new Set(state.sessions.filter((s) => s.date === TODAY).map((s) => s.id));
  const validBookings = state.bookings.filter(
    (b) => todaySessionIds.has(b.sessionId) && b.status === "confirmed" && b.checkInStatus === "pending",
  );

  const handleCheckIn = (id: string) => {
    const result = checkInByBookingId(id);
    if (!result) {
      setFlash({ kind: "err", msg: `Booking ${id} not found or not checkable.` });
    } else {
      const client = clients.find((c) => c.id === result.booking.clientId);
      setFlash({
        kind: "ok",
        msg: `${client ? client.firstName + " " + client.lastName : "Client"} checked in for ${result.session.name}.`,
      });
    }
    setTimeout(() => setFlash(null), 4000);
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Check-in" description="Scan QR or enter booking ID to check clients in." />

      {flash && (
        <div
          className={
            "rounded-xl px-4 py-3 text-sm " +
            (flash.kind === "ok" ? "bg-sage/10 text-sage" : "bg-error/10 text-error")
          }
        >
          {flash.msg}
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <ScannerSim validBookings={validBookings} onScan={handleCheckIn} />
        <Card className="px-5 py-4">
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-ink/70">
            Manual entry
          </h3>
          <ManualInput onSubmit={handleCheckIn} />
          <div className="mt-4 text-[11px] text-ink/50">
            Valid today: {validBookings.length} bookings pending check-in.
          </div>
        </Card>
      </div>

      <div>
        <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-ink/70">
          Recent check-ins
        </h3>
        <RecentCheckIns bookings={state.bookings} clients={clients} sessions={state.sessions} />
      </div>
    </div>
  );
}
