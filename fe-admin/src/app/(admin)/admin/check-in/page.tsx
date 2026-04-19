"use client";

import { useCallback, useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/ui";
import { QrScanner } from "@/components/domain/checkin/qr-scanner";
import { ExpectedList } from "@/components/domain/checkin/expected-list";
import { findBookingByQr, recordCheckIn } from "@/lib/mutations/checkin";

export default function CheckInPage() {
  const [matchedId, setMatchedId] = useState<string | null>(null);

  const onResult = useCallback((decoded: string) => {
    const booking = findBookingByQr(decoded);
    if (!booking) {
      toast.error("No matching booking");
      return;
    }
    recordCheckIn(booking.id);
    setMatchedId(booking.id);
    toast.success(`Checked in ${booking.id}`);
  }, []);

  return (
    <>
      <PageHeader
        title="Check-in"
        description="Scan a booking QR or fall back to name search. Today's expected attendees below."
      />
      <div className="mt-6 grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-1">
          <QrScanner onResult={onResult} />
        </div>
        <div className="lg:col-span-2">
          <ExpectedList
            highlightBookingId={matchedId}
            onClearHighlight={() => setMatchedId(null)}
          />
        </div>
      </div>
    </>
  );
}
