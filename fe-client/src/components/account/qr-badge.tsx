"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { QRCodeSVG } from "qrcode.react";
import { X } from "lucide-react";
import { useFocusTrap } from "@/lib/use-focus-trap";
import { useBodyScrollLock } from "@/lib/use-body-scroll-lock";
import { Portal } from "@/components/ui/portal";

type Props = {
  value: string;
  label?: string;
  subLabel?: string;
};

export function QrBadge({ value, label, subLabel }: Props) {
  const [open, setOpen] = useState(false);
  const trapRef = useFocusTrap<HTMLDivElement>(open);
  useBodyScrollLock(open);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

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
        className="shrink-0 flex h-11 w-11 items-center justify-center rounded-lg border border-ink/10 bg-card hover:border-accent transition-colors"
      >
        <QRCodeSVG
          value={value}
          size={32}
          level="M"
          marginSize={0}
          bgColor="transparent"
        />
      </button>

      {open && (
        <Portal>
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-ink/60 backdrop-blur-sm p-4"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setOpen(false);
          }}
        >
          <div
            ref={trapRef}
            role="dialog"
            aria-modal="true"
            aria-label={label ? `QR code — ${label}` : "QR code"}
            tabIndex={-1}
            className="relative w-full max-w-sm max-h-[85dvh] overflow-y-auto rounded-2xl bg-card p-6 sm:p-8 shadow-modal outline-none"
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
              className="absolute top-2 right-2 flex h-11 w-11 items-center justify-center rounded-full text-muted hover:bg-ink/5 hover:text-ink transition-colors"
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
              {/* The code scales to the panel instead of a fixed 240px, which
                  overflowed a 320px screen. It never grows past 240 so the
                  scanner sees the same size it always did on larger screens. */}
              <div className="w-full max-w-[240px] rounded-xl bg-paper border border-ink/10 p-4">
                <QRCodeSVG
                  value={value}
                  size={240}
                  level="M"
                  className="h-auto w-full"
                />
              </div>
            </div>
            <p className="mt-4 text-center text-xs text-muted">
              Show this code at the studio to check in.
            </p>
          </div>
        </div>
        </Portal>
      )}
    </>
  );
}

type FullScreenProps = {
  /** The booking's `qr_token`: what the studio's scanner reads. */
  value: string;
  /** The booking's typed code, for when the scanner can't read the screen. */
  code: string;
  title: string;
  subtitle?: string;
  onClose: () => void;
};

/**
 * The booking QR filling a phone screen, with the typed code under it.
 *
 * Literal black on white rather than the theme's ink/paper: a studio's theme
 * can tint those, and a scanner reads contrast. The page can't raise the
 * screen's brightness, so contrast is the one lever left. Portalled to `body`
 * so a transformed ancestor can't trap the fixed overlay. Mount it only while
 * open; it locks scroll and traps focus for as long as it is mounted.
 */
export function QrFullScreen({ value, code, title, subtitle, onClose }: FullScreenProps) {
  const trapRef = useFocusTrap<HTMLDivElement>(true);
  useBodyScrollLock(true);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return createPortal(
    <div
      ref={trapRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="qr-fullscreen-title"
      data-testid="booking-qr-dialog"
      tabIndex={-1}
      className="fixed inset-0 z-[100] flex flex-col overflow-y-auto bg-white text-black outline-none"
    >
      <div className="flex justify-end p-2">
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="inline-flex h-12 w-12 items-center justify-center rounded-full text-black hover:bg-black/5"
        >
          <X className="h-6 w-6" />
        </button>
      </div>
      <div className="flex flex-1 flex-col items-center justify-center px-4 pb-10">
        <h2 id="qr-fullscreen-title" className="text-center text-xl font-semibold break-words">
          {title}
        </h2>
        {subtitle && <p className="mt-1 text-center text-base text-black/70">{subtitle}</p>}
        {/* Most of the width on a phone, capped by the height so a landscape
            screen still shows the code under it. */}
        <div className="mt-6 w-full max-w-[min(100%,60dvh,420px)] bg-white">
          <QRCodeSVG
            value={value}
            size={420}
            level="M"
            marginSize={2}
            bgColor="#ffffff"
            fgColor="#000000"
            className="block h-auto w-full"
            role="img"
            aria-label="Check-in QR code"
          />
        </div>
        <p className="mt-4 text-center text-xs uppercase tracking-wider text-black/70">
          Booking code
        </p>
        <p
          data-testid="booking-qr-code"
          className="mt-1 text-center font-mono text-4xl font-bold tracking-wider break-all select-all"
        >
          {code}
        </p>
        <p className="mt-4 text-center text-sm text-black/70">
          Show this at the studio to check in.
        </p>
      </div>
    </div>,
    document.body,
  );
}
