"use client";

import { useEffect, useRef, useState } from "react";
import { Camera, CameraOff } from "lucide-react";
import { Button } from "@/components/ui";

export interface QrScannerProps {
  onResult: (decoded: string) => void;
}

export function QrScanner({ onResult }: QrScannerProps) {
  const [active, setActive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  // We don't strictly type the html5-qrcode instance to avoid pulling its types in.
  const scannerRef = useRef<{ stop: () => Promise<void>; clear: () => void } | null>(null);

  useEffect(() => {
    if (!active) return;

    let cancelled = false;
    const startScanner = async () => {
      try {
        const mod = await import("html5-qrcode");
        if (cancelled) return;
        const div = containerRef.current;
        if (!div) return;
        const Html5Qrcode = mod.Html5Qrcode;
        const id = "qr-reader-region";
        div.innerHTML = `<div id="${id}" class="rounded-md overflow-hidden border border-border" style="width:100%;max-width:360px;"></div>`;
        const scanner = new Html5Qrcode(id);
        scannerRef.current = scanner as unknown as typeof scannerRef.current;
        await scanner.start(
          { facingMode: "environment" },
          { fps: 10, qrbox: 240 },
          (decodedText) => {
            onResult(decodedText);
          },
          () => {
            // ignore decode errors
          },
        );
      } catch (err) {
        setError(err instanceof Error ? err.message : "Camera unavailable");
        setActive(false);
      }
    };

    void startScanner();

    return () => {
      cancelled = true;
      const inst = scannerRef.current;
      scannerRef.current = null;
      if (inst) {
        inst
          .stop()
          .then(() => inst.clear())
          .catch(() => {});
      }
    };
  }, [active, onResult]);

  if (!active) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-card p-6 text-center">
        <Camera className="mx-auto mb-2 h-6 w-6 text-muted" />
        <p className="text-sm text-muted">
          {error ? `Camera blocked: ${error}` : "Use your device camera to scan a booking QR."}
        </p>
        <Button type="button" onClick={() => setActive(true)} className="mt-3">
          Start scanner
        </Button>
        <p className="mt-2 text-xs text-muted">Or fall back to the name search below.</p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div ref={containerRef} className="flex justify-center" />
      <div className="mt-3 flex items-center justify-end">
        <Button type="button" variant="ghost" onClick={() => setActive(false)}>
          <CameraOff className="mr-1 h-4 w-4" /> Stop
        </Button>
      </div>
    </div>
  );
}
