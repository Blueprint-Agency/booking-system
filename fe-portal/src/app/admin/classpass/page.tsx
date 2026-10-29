"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Copy, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button, PageHeader } from "@/components/ui";
import { ClassPassLocationMappings } from "@/components/classpass/location-mappings";
import { ClassPassReview } from "@/components/classpass/review-list";
import { ClassPassSetupGuide } from "@/components/classpass/setup-guide";
import { ApiError } from "@/lib/api";
import { useWorkspace } from "@/lib/workspace-context";
import { formatDateTime } from "@/lib/formatters";
import {
  getClassPass,
  outcomeRows,
  overbookedHeadline,
  regenerateClassPassAddress,
  ROSTER_DIFFERENCE_LABELS,
  setClassPassEnabled,
  SETUP_POLL_MS,
  setupGuide,
  type ClassPassSettings,
  type ClassPassStatus,
} from "@/lib/classpass";

/**
 * ClassPass: the studio forwards ClassPass's emails to its
 * private ClassPass address, and ClassPass bookings are imported from them.
 * Admins only; the backend refuses instructors.
 */
export default function ClassPassPage() {
  const { api, locations } = useWorkspace();
  const [status, setStatus] = useState<ClassPassStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmRegenerate, setConfirmRegenerate] = useState(false);
  // Bumped by Retry; loading until the attempt asked for has an answer.
  const [attempt, setAttempt] = useState(0);
  const [answered, setAnswered] = useState<number | null>(null);
  const loading = answered !== attempt;
  const [mappingsRevision, setMappingsRevision] = useState(0);
  const [reviewRevision, setReviewRevision] = useState(0);

  useEffect(() => {
    if (!api) return;
    let cancelled = false;
    getClassPass(api).then(
      (view) => {
        if (cancelled) return;
        setStatus(view);
        setError(null);
        setAnswered(attempt);
      },
      (err) => {
        if (cancelled) return;
        setError(err instanceof ApiError ? `HTTP ${err.status}` : "Network error");
        setAnswered(attempt);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [api, attempt]);

  // While a setup step is still to be done, ask for news every few seconds so its tick appears by itself;
  // stop once every step is done. New mail may have changed the review list, so it is read again too.
  const polling = status ? setupGuide(status.setup).poll : false;
  const lastReceived = useRef<string | null>(null);
  const statusReceived = status?.last_received_at ?? null;
  useEffect(() => {
    lastReceived.current = statusReceived;
  }, [statusReceived]);
  useEffect(() => {
    if (!api || !polling) return;
    const timer = setInterval(() => {
      if (typeof document !== "undefined" && document.hidden) return;
      getClassPass(api).then(
        (view) => {
          if (view.last_received_at !== lastReceived.current) setReviewRevision((n) => n + 1);
          setStatus(view);
        },
        () => undefined,
      );
    }, SETUP_POLL_MS);
    return () => clearInterval(timer);
  }, [api, polling]);

  const act = useCallback(
    async (work: () => Promise<ClassPassSettings>, done: string) => {
      if (!api || busy) return;
      setBusy(true);
      try {
        const settings = await work();
        // A change answers without the roster check, which it doesn't change: keep the one read.
        setStatus((was) => (was ? { ...was, ...settings } : was));
        toast.success(done);
      } catch (err) {
        toast.error(err instanceof ApiError ? `That didn’t work (HTTP ${err.status}).` : "That didn’t work.");
      } finally {
        setBusy(false);
      }
    },
    [api, busy],
  );

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center gap-2 text-sm text-muted">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading ClassPass…
      </div>
    );
  }

  if (error || !status || !api) {
    return (
      <div className="mx-auto max-w-3xl rounded-xl border border-error/30 bg-error/5 p-6 text-center">
        <p className="text-sm text-error">Failed to load: {error ?? "no answer"}</p>
        <Button size="sm" variant="ghost" onClick={() => setAttempt((n) => n + 1)} className="mt-2">
          Retry
        </Button>
      </div>
    );
  }

  const { rows, total } = outcomeRows(status.counts);
  const refreshStatus = () => void getClassPass(api).then(setStatus, () => undefined);

  async function copy(text: string, done: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(done);
    } catch {
      toast.error("Couldn’t copy. Select the text and copy it instead.");
    }
  }

  function copyAddress() {
    if (status?.address) void copy(status.address, "Address copied.");
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        title="ClassPass"
        description="Forward ClassPass’s emails to your ClassPass address, and the bookings ClassPass members make land on your own roster."
      />

      <ClassPassSetupGuide
        api={api}
        status={status}
        locations={locations}
        busy={busy}
        onEnable={() => act(() => setClassPassEnabled(api, true), "ClassPass import turned on.")}
        onCopy={copy}
        onMapped={() => {
          setMappingsRevision((n) => n + 1);
          setReviewRevision((n) => n + 1);
          refreshStatus();
        }}
        reviewRevision={reviewRevision}
      />

      <section className="flex items-start justify-between gap-4 rounded-xl border border-border bg-card p-4 shadow-soft sm:p-6">
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-ink">Import ClassPass bookings</h2>
          <p className="mt-1 text-sm text-muted">
            {status.enabled
              ? "On. Emails forwarded to your ClassPass address are received and kept."
              : "Off. Turn it on once Gmail forwarding is set up."}
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={status.enabled}
          aria-label="Import ClassPass bookings"
          disabled={busy}
          onClick={() =>
            act(
              () => setClassPassEnabled(api, !status.enabled),
              status.enabled ? "ClassPass import turned off." : "ClassPass import turned on.",
            )
          }
          className={`relative mt-0.5 inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors before:absolute before:-inset-2 before:content-[''] disabled:opacity-50 ${
            status.enabled ? "bg-accent" : "bg-border"
          }`}
        >
          <span
            className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ${
              status.enabled ? "translate-x-5" : "translate-x-0.5"
            }`}
          />
        </button>
      </section>

      <section className="rounded-xl border border-border bg-card p-4 shadow-soft sm:p-6">
        <header className="mb-4">
          <h2 className="text-base font-semibold text-ink">Your ClassPass address</h2>
          <p className="mt-0.5 text-xs text-muted">
            Private to your studio. Anyone who has it can send mail to it, so keep it to your Gmail settings.
          </p>
        </header>
        {status.address ? (
          <div className="flex flex-wrap items-center gap-2">
            <code className="min-w-0 break-all rounded-md border border-border bg-paper px-3 py-2 text-sm text-ink">
              {status.address}
            </code>
            <Button size="sm" variant="ghost" onClick={copyAddress}>
              <Copy className="h-4 w-4" /> Copy
            </Button>
          </div>
        ) : (
          <p className="text-sm text-muted">Your ClassPass address isn’t available yet. Please check back later.</p>
        )}
        <div className="mt-4">
          {confirmRegenerate ? (
            <div className="rounded-md border border-warning/40 bg-warning/5 p-3">
              <p className="text-sm text-ink">
                Replace this address? The current one stops working at once, and you will need to set up Gmail
                forwarding to the new one.
              </p>
              <div className="mt-2 flex gap-2">
                <Button
                  size="sm"
                  disabled={busy}
                  onClick={async () => {
                    await act(() => regenerateClassPassAddress(api), "New ClassPass address made.");
                    setConfirmRegenerate(false);
                  }}
                >
                  Replace address
                </Button>
                <Button size="sm" variant="ghost" disabled={busy} onClick={() => setConfirmRegenerate(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <Button size="sm" variant="ghost" onClick={() => setConfirmRegenerate(true)}>
              <RefreshCw className="h-4 w-4" /> Regenerate address
            </Button>
          )}
        </div>
      </section>

      {/* A mapping re-runs the review items from its location, and mapping from an item adds a mapping: each
          panel's change refreshes the other, and the status. */}
      <div id="classpass-locations" className="scroll-mt-20">
        <ClassPassLocationMappings
          api={api}
          locations={locations}
          revision={mappingsRevision}
          onChanged={() => {
            setReviewRevision((n) => n + 1);
            refreshStatus();
          }}
        />
      </div>

      <div id="classpass-review" className="scroll-mt-20">
        <ClassPassReview
          api={api}
          locations={locations}
          revision={reviewRevision}
          onChanged={() => {
            setMappingsRevision((n) => n + 1);
            refreshStatus();
          }}
        />
      </div>

      <section className="rounded-xl border border-border bg-card p-4 shadow-soft sm:p-6">
        <header className="mb-4">
          <h2 className="text-base font-semibold text-ink">Import status</h2>
          <p className="mt-0.5 text-xs text-muted">
            {status.last_received_at
              ? `Last email received ${formatDateTime(status.last_received_at)}. ${total} received in all.`
              : "No email received yet."}
          </p>
        </header>
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {rows.map((row) => (
            <div key={row.outcome} className="rounded-md border border-border bg-paper px-3 py-2">
              <dt className="text-xs text-muted">{row.label}</dt>
              <dd className="text-lg font-semibold text-ink">{row.count}</dd>
            </div>
          ))}
        </dl>
        {status.overbooked.length > 0 && (
          <div role="status" className="mt-4 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-ink">
            <p className="font-medium">{overbookedHeadline(status.overbooked)}</p>
            <ul className="mt-1 space-y-0.5 text-xs text-muted">
              {status.overbooked.map((o) => (
                <li key={o.booking_id}>
                  {o.client_name} · {o.class_name} · {formatDateTime(o.starts_at)}
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <section className="rounded-xl border border-border bg-card p-4 shadow-soft sm:p-6">
        <header className="mb-4">
          <h2 className="text-base font-semibold text-ink">Roster check</h2>
          <p className="mt-0.5 text-xs text-muted">
            ClassPass’s Daily Roster from the last week, compared with the ClassPass bookings on your rosters.
            Nothing is changed for you: book or cancel by hand where it’s needed.
          </p>
        </header>
        {status.roster_check.differences.length === 0 ? (
          <p className="text-sm text-muted">No differences.</p>
        ) : (
          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full min-w-[560px]">
              <thead className="bg-paper">
                <tr className="text-left text-xs uppercase tracking-wider text-muted">
                  <th className="px-4 py-2 font-medium">Member</th>
                  <th className="px-4 py-2 font-medium">Class</th>
                  <th className="px-4 py-2 font-medium">Difference</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {status.roster_check.differences.map((d) => (
                  <tr key={`${d.difference}-${d.class_id ?? d.class_name}-${d.starts_at}-${d.member_name}-${d.booking_id ?? ""}`}>
                    <td className="px-4 py-2 text-sm text-ink">{d.member_name}</td>
                    <td className="whitespace-nowrap px-4 py-2 text-sm text-ink">
                      {d.class_name} · {formatDateTime(d.starts_at)}
                      {!d.class_id && <span className="ml-1 text-xs text-muted">(no matching class)</span>}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2 text-sm text-ink">
                      {ROSTER_DIFFERENCE_LABELS[d.difference]}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {status.roster_check.unchecked.length > 0 && (
          <div role="status" className="mt-4 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-ink">
            <p className="font-medium">Some rosters couldn’t be checked: their location isn’t mapped.</p>
            <ul className="mt-1 space-y-0.5 text-xs text-muted">
              {status.roster_check.unchecked.map((u) => (
                <li key={`${u.location_name ?? ""}-${u.received_at}`}>
                  {u.location_name ?? "No location named"} · received {formatDateTime(u.received_at)}
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>
    </div>
  );
}
