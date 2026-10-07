"use client";

import { useEffect, useState } from "react";
import { StudioMark } from "@/components/brand/studio-mark";
import { makeApi } from "@/lib/api";
import { MAINTENANCE_RECHECK_MS, onMaintenance } from "@/lib/maintenance";

const anonymous = makeApi(async () => null);

/**
 * A studio's portal, unless the platform is in maintenance (`lib/maintenance.ts`).
 * Once any call is answered `503 maintenance`, the portal is replaced by a
 * full-page screen with the platform's message, which asks again every
 * `MAINTENANCE_RECHECK_MS` and reloads the page into the portal when the answer
 * is no longer maintenance — a reload, so nothing loaded while it was refused
 * is shown again. Not mounted on the super portal's hostname (`app/layout.tsx`).
 */
export function MaintenanceGate({ children }: { children: React.ReactNode }) {
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    onMaintenance(setMessage);
    return () => onMaintenance(null);
  }, []);

  useEffect(() => {
    if (message === null) return;
    const timer = setInterval(() => {
      // Still maintenance: the 503 is noted again (with any new wording) and
      // this throws. Any other failure is not an answer either way.
      anonymous.get("/public/maintenance").then(() => window.location.reload(), () => {});
    }, MAINTENANCE_RECHECK_MS);
    return () => clearInterval(timer);
  }, [message]);

  if (message === null) return <>{children}</>;
  return (
    <main className="flex min-h-dvh items-center justify-center px-6 py-16">
      <div className="flex max-w-md flex-col items-center text-center" role="status" aria-live="polite">
        <div className="flex items-center gap-3">
          <StudioMark size="auth" />
        </div>
        <p className="mt-8 text-xs uppercase tracking-widest text-muted">Maintenance</p>
        <h1 className="mt-3 text-2xl font-bold text-ink">{message}</h1>
        <p className="mt-4 inline-flex items-center gap-2 text-sm text-muted">
          <span className="h-2 w-2 animate-pulse rounded-full bg-accent" aria-hidden />
          This page will come back by itself when we&apos;re done.
        </p>
      </div>
    </main>
  );
}
