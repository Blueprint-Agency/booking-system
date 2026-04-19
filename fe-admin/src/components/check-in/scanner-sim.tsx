"use client";

import { useState } from "react";
import { QrCode } from "lucide-react";
import type { Booking } from "@/types";
import { Button } from "@/components/ui/button";

export function ScannerSim({
  validBookings,
  onScan,
}: {
  validBookings: Booking[];
  onScan: (bookingId: string) => void;
}) {
  const [cursor, setCursor] = useState(0);

  const simulate = () => {
    if (validBookings.length === 0) return;
    const b = validBookings[cursor % validBookings.length];
    setCursor((c) => c + 1);
    onScan(b.id);
  };

  return (
    <div className="rounded-2xl border border-ink/10 bg-paper/40 p-6">
      <div className="mb-4 flex aspect-video items-center justify-center rounded-xl border-2 border-dashed border-ink/15 bg-white">
        <div className="text-center text-ink/40">
          <QrCode className="mx-auto h-14 w-14" />
          <div className="mt-2 text-xs uppercase tracking-wide">Camera preview (mock)</div>
        </div>
      </div>
      <Button onClick={simulate} disabled={validBookings.length === 0} className="w-full">
        Simulate scan{validBookings.length > 0 ? ` (${validBookings.length} valid)` : ""}
      </Button>
    </div>
  );
}
