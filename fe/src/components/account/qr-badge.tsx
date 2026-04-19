"use client";

import { useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { X } from "lucide-react";

type Props = {
  value: string;
  label?: string;
  subLabel?: string;
};

export function QrBadge({ value, label, subLabel }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen(true);
        }}
        aria-label="Show QR code"
        className="shrink-0 rounded-md border border-ink/10 bg-paper p-1 hover:border-accent transition-colors"
      >
        <QRCodeSVG
          value={value}
          size={36}
          level="M"
          marginSize={0}
          bgColor="transparent"
        />
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black p-4"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setOpen(false);
          }}
        >
          <div
            className="relative w-full max-w-sm rounded-2xl bg-paper border border-ink/10 p-8 shadow-hover"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
          >
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                setOpen(false);
              }}
              aria-label="Close"
              className="absolute top-4 right-4 text-muted hover:text-ink transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
            {label && (
              <p className="text-center text-lg font-semibold text-ink">{label}</p>
            )}
            {subLabel && (
              <p className="text-center text-sm text-muted mt-1">{subLabel}</p>
            )}
            <div className="mt-6 flex justify-center">
              <div className="rounded-xl bg-paper border border-ink/10 p-4">
                <QRCodeSVG value={value} size={240} level="M" />
              </div>
            </div>
            <p className="mt-4 text-center text-xs text-muted">
              Show this code at the studio to check in.
            </p>
          </div>
        </div>
      )}
    </>
  );
}
