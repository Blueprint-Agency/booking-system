"use client";

import { useEffect, useState } from "react";
import { useBrand } from "@/components/brand/brand-provider";
import { handleExpiredSession } from "@/lib/member-auth";
import { onStudioRefusal, type StudioRefusal } from "@/lib/studio-refusal";

/**
 * The whole app, unless the studio refuses it (`lib/studio-refusal.ts`, #250).
 *
 * `paused` is the studio's status as the server read it by slug, so a
 * suspended studio's first paint is already the paused page. Each way out is
 * a full page load, so nothing the app read while it was refused is drawn again.
 */
export function StudioGate({ paused, children }: { paused: boolean; children: React.ReactNode }) {
  const [refusal, setRefusal] = useState<StudioRefusal["kind"] | null>(paused ? "paused" : null);

  useEffect(() => {
    onStudioRefusal((heard) => {
      if (heard.kind === "other-studio") handleExpiredSession(heard.sentToken);
      setRefusal((current) => (current === "paused" ? current : heard.kind));
    });
    return () => onStudioRefusal(null);
  }, []);

  if (refusal === "paused") {
    return (
      <RefusalScreen
        eyebrow="Paused"
        title="This studio is closed right now"
        detail="Booking, sign-up and member accounts are paused while it's closed. Nothing on your account has changed, and this page opens as usual when the studio reopens."
        primary={{ label: "Check again", go: () => window.location.reload() }}
      />
    );
  }
  if (refusal === "other-studio") {
    return (
      <RefusalScreen
        eyebrow="Signed out"
        title="You were signed in at a different studio"
        detail="Each studio has its own sign-in. Sign in here to see your account at this studio."
        primary={{ label: "Sign in", go: () => window.location.assign("/login") }}
        secondary={{ label: "Browse classes", go: () => window.location.assign("/") }}
      />
    );
  }
  return <>{children}</>;
}

type Action = { label: string; go: () => void };

function RefusalScreen({
  eyebrow,
  title,
  detail,
  primary,
  secondary,
}: {
  eyebrow: string;
  title: string;
  detail: string;
  primary: Action;
  secondary?: Action;
}) {
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
        <p className="mt-8 font-mono text-xs uppercase tracking-widest text-muted">{eyebrow}</p>
        <h1 className="mt-3 text-2xl font-extrabold text-ink">{title}</h1>
        <p className="mt-2 text-sm text-muted">{detail}</p>
        <div className="mt-6 flex flex-col items-stretch justify-center gap-3 sm:flex-row sm:items-center">
          <button
            type="button"
            onClick={primary.go}
            className="inline-flex min-h-[44px] items-center justify-center rounded-full bg-accent px-6 text-sm font-semibold text-white transition-colors hover:bg-accent-deep dark:hover:bg-accent/85"
          >
            {primary.label}
          </button>
          {secondary && (
            <button
              type="button"
              onClick={secondary.go}
              className="inline-flex min-h-[44px] items-center justify-center rounded-full border border-border bg-card px-6 text-sm font-medium text-ink transition-colors hover:bg-paper"
            >
              {secondary.label}
            </button>
          )}
        </div>
      </div>
    </main>
  );
}
