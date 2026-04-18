"use client";

import { QRCodeSVG } from "qrcode.react";
import { SectionHeading } from "@/components/booking/section-heading";
import { MOCK_USER } from "@/data/mock-user";

const MEMBER_SINCE = "January 2024";

export default function MyQRCode() {
  const qrValue = `YS-MEMBER-${MOCK_USER.id.toUpperCase()}`;

  return (
    <div>
      <SectionHeading
        eyebrow="Check-in"
        title="Your studio QR"
        description="Show this at the front desk to check into your class."
        align="center"
      />

      <div className="max-w-md mx-auto rounded-3xl bg-card border border-ink/5 shadow-soft p-10 text-center">
        <div className="h-64 w-64 mx-auto rounded-2xl bg-paper border border-ink/10 p-4 flex items-center justify-center">
          <QRCodeSVG value={qrValue} size={208} />
        </div>

        <p className="text-lg font-semibold mt-6 text-ink">{MOCK_USER.name}</p>
        <p className="text-sm text-muted">Member since {MEMBER_SINCE}</p>

        <div className="mt-8 flex gap-3 justify-center">
          <button
            type="button"
            onClick={() => {}}
            className="rounded-full border border-ink/10 px-5 py-3 text-sm font-medium hover:border-accent transition-colors"
          >
            Download PNG
          </button>
          <button
            type="button"
            onClick={() => {}}
            className="rounded-full bg-ink text-paper px-5 py-3 text-sm font-medium hover:bg-ink/90 transition-colors"
          >
            Add to Wallet
          </button>
        </div>
      </div>
    </div>
  );
}
