"use client";

import { useEffect, useState } from "react";
import { useBrand } from "@/components/brand/brand-provider";
import { publicApi } from "@/lib/api";
import { MAINTENANCE_RECHECK_MS, onMaintenance } from "@/lib/maintenance";

/**
 * The whole app, unless the platform is in maintenance (`lib/maintenance.ts`).
 * Once any call is answered `503 maintenance`, the app is replaced by a
 * full-page screen with the platform's message, which asks again every
 * `MAINTENANCE_RECHECK_MS` and reloads the page into the app when the answer
 * is no longer maintenance — a reload, so nothing the app loaded while it was
 * refused is shown again.
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
      publicApi.get("/public/maintenance").then(() => window.location.reload(), () => {});
    }, MAINTENANCE_RECHECK_MS);
    return () => clearInterval(timer);
  }, [message]);

  if (message === null) return <>{children}</>;
  return <MaintenanceScreen message={message} />;
}

function MaintenanceScreen({ message }: { message: string }) {
  const brand = useBrand();
  return (
    <main className="flex min-h-dvh items-center justify-center px-6 py-16">
      <div className="max-w-md text-center" role="status" aria-live="polite">
        {brand.logoUrl ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img src={brand.logoUrl} alt={brand.name} className="mx-auto h-10 w-auto" />
        ) : (
          <p className="text-lg font-bold tracking-tight text-ink">{brand.name}</p>
        )}
        <p className="mt-8 font-mono text-xs uppercase tracking-widest text-muted">Maintenance</p>
        <h1 className="mt-3 text-2xl font-extrabold text-ink">{message}</h1>
        <p className="mt-4 inline-flex items-center gap-2 text-sm text-muted">
          <span className="h-2 w-2 animate-pulse rounded-full bg-accent" aria-hidden />
          This page will come back by itself when we&apos;re done.
        </p>
      </div>
    </main>
  );
}
