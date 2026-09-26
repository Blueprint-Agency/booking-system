"use client";
import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { PageHeader } from "@/components/ui";
import { useWorkspace } from "@/lib/workspace-context";
import { ApiError } from "@/lib/api";
import { formatDateTime } from "@/lib/formatters";
import { fetchFeatureFlags, setFeatureFlag, type FeatureFlagState } from "@/lib/feature-flags";

/**
 * The studio's switchboard (be-portal.md §feature-flags.ts). Each switch is
 * this studio's alone; turning one on or off never reaches another studio.
 */
export default function FeatureFlagsPage() {
  const { api } = useWorkspace();
  const [flags, setFlags] = useState<FeatureFlagState[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!api) return;
    try {
      setFlags(await fetchFeatureFlags(api));
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? `Couldn't load the switches (HTTP ${err.status}).` : "Network error");
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  async function toggle(flag: FeatureFlagState) {
    if (!api || busyKey) return;
    setBusyKey(flag.key);
    setError(null);
    try {
      await setFeatureFlag(api, flag.key, !flag.enabled);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? `Couldn't change the switch (HTTP ${err.status}).` : "Network error");
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Features" description="Studio-wide switches. Each takes effect straight away." />

      {error && (
        <p className="mb-4 rounded-md border border-error/30 bg-error/5 px-3 py-2 text-xs text-error">{error}</p>
      )}

      {!flags ? (
        !error && (
          <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        )
      ) : (
        <ul className="divide-y divide-border rounded-xl border border-border bg-card shadow-soft">
          {flags.map((f) => (
            <li key={f.key} className="flex items-start justify-between gap-4 p-4 sm:p-5">
              <div className="min-w-0">
                <div className="text-sm font-semibold text-ink">{f.label}</div>
                <p className="mt-1 text-sm text-muted">{f.description}</p>
                {f.updated_at && (
                  <p className="mt-1 text-xs text-muted">Last changed {formatDateTime(f.updated_at)}</p>
                )}
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={f.enabled}
                aria-label={f.label}
                disabled={busyKey !== null}
                onClick={() => toggle(f)}
                // The before: box widens the hit area to thumb size without
                // growing the switch itself.
                className={`relative mt-0.5 inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors before:absolute before:-inset-2 before:content-[''] disabled:opacity-50 ${
                  f.enabled ? "bg-accent" : "bg-border"
                }`}
              >
                <span
                  className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ${
                    f.enabled ? "translate-x-5" : "translate-x-0.5"
                  }`}
                />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
