"use client";
import { useCallback, useEffect, useState } from "react";
import { Copy, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button, PageHeader } from "@/components/ui";
import { ApiError } from "@/lib/api";
import { useWorkspace } from "@/lib/workspace-context";
import { formatDateTime } from "@/lib/formatters";
import {
  CLASSPASS_SENDER,
  getClassPass,
  outcomeRows,
  regenerateClassPassAddress,
  setClassPassEnabled,
  type ClassPassStatus,
} from "@/lib/classpass";

/**
 * ClassPass (#407, #409): the studio forwards ClassPass's emails to its
 * private ClassPass address, and ClassPass bookings are imported from them.
 * Admins only; the backend refuses instructors.
 */
export default function ClassPassPage() {
  const { api } = useWorkspace();
  const [status, setStatus] = useState<ClassPassStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmRegenerate, setConfirmRegenerate] = useState(false);
  // Bumped by Retry; loading until the attempt asked for has an answer.
  const [attempt, setAttempt] = useState(0);
  const [answered, setAnswered] = useState<number | null>(null);
  const loading = answered !== attempt;

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

  const act = useCallback(
    async (work: () => Promise<ClassPassStatus>, done: string) => {
      if (!api || busy) return;
      setBusy(true);
      try {
        setStatus(await work());
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

  async function copyAddress() {
    if (!status?.address) return;
    try {
      await navigator.clipboard.writeText(status.address);
      toast.success("Address copied.");
    } catch {
      toast.error("Couldn’t copy. Select the address and copy it instead.");
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        title="ClassPass"
        description="Forward ClassPass’s emails to your ClassPass address, and the bookings ClassPass members make land on your own roster."
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

      <section className="rounded-xl border border-border bg-card p-4 shadow-soft sm:p-6">
        <header className="mb-4">
          <h2 className="text-base font-semibold text-ink">Set up Gmail forwarding</h2>
          <p className="mt-0.5 text-xs text-muted">In the Gmail account ClassPass emails your studio at.</p>
        </header>
        <ol className="list-decimal space-y-3 pl-5 text-sm text-ink">
          <li>
            In Gmail, open <strong>Settings → See all settings → Forwarding and POP/IMAP</strong>, choose{" "}
            <strong>Add a forwarding address</strong>, and enter your ClassPass address.
          </li>
          <li>
            Gmail sends that address a confirmation code. Enter it in Gmail to verify the address.
            <div className="mt-2 rounded-md border border-border bg-paper px-3 py-2">
              {status.gmail_confirmation_code ? (
                <>
                  <span className="text-xs text-muted">Confirmation code</span>
                  <div className="font-mono text-lg font-semibold tracking-wider text-ink">
                    {status.gmail_confirmation_code}
                  </div>
                  {status.gmail_confirmation_at && (
                    <span className="text-xs text-muted">Received {formatDateTime(status.gmail_confirmation_at)}</span>
                  )}
                </>
              ) : (
                <span className="text-xs text-muted">
                  The code shows here once Gmail sends it.{" "}
                  <button type="button" className="underline" onClick={() => setAttempt((n) => n + 1)}>
                    Check again
                  </button>
                </span>
              )}
            </div>
          </li>
          <li>
            Don’t forward everything. Instead, <strong>create a filter</strong> with From{" "}
            <code className="rounded bg-paper px-1">{CLASSPASS_SENDER}</code>, and choose{" "}
            <strong>Forward it to</strong> your ClassPass address.
          </li>
          <li>Turn on <strong>Import ClassPass bookings</strong> above.</li>
        </ol>
      </section>

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
      </section>
    </div>
  );
}
