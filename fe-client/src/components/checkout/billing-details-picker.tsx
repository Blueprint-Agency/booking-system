"use client";

/**
 * Who this purchase is billed to (#401): the member's saved Billing details,
 * the default selected, any other one a tap away, and a set added or edited
 * without leaving checkout. The chosen set is sent with the checkout and
 * printed on the Receipt as "Bill to".
 *
 * A member with none is shown the add form at once; on save it is selected
 * and they carry on with the purchase they were making, every other choice on
 * the page as they left it, because the page never unmounts.
 *
 * Controlled: the page holds the chosen id and keeps Pay disabled until there
 * is one. It hears where the list stands through `onStatus`, so Pay can say
 * why it waits (`billToPayLabel`); a list that failed to load offers a retry.
 */
import { useEffect, useRef, useState } from "react";
import { Pencil, Plus } from "lucide-react";
import { BillingDetailsSheet } from "@/components/account/billing-details-sheet";
import { useAppUser } from "@/lib/auth";
import {
  addressLines,
  BILLING_DETAILS_LIMIT,
  useBillingDetails,
  type BillingDetails,
} from "@/lib/billing-details";
import type { BillToStatus } from "@/lib/bill-to-status";
import { cn } from "@/lib/utils";

type Sheet = { mode: "add" } | { mode: "edit"; set: BillingDetails } | null;

export function BillingDetailsPicker({
  value,
  onChange,
  onStatus,
}: {
  /** The chosen set's id, or null until there is one. */
  value: string | null;
  onChange: (id: string | null) => void;
  /** Where the member's list stands: loading, failed to load, or read. */
  onStatus?: (status: BillToStatus) => void;
}) {
  const { sets, loading, failed, refetch, retry } = useBillingDetails();
  const { user } = useAppUser();
  const [sheet, setSheet] = useState<Sheet>(null);
  // The add form opens by itself once, for a member with none; closing it
  // leaves the button to open it again rather than reopening on every render.
  const prompted = useRef(false);
  const ownName = user ? `${user.firstName} ${user.lastName}`.trim() : "";

  useEffect(() => {
    onStatus?.(loading ? "loading" : failed ? "failed" : "ready");
  }, [loading, failed, onStatus]);

  useEffect(() => {
    if (loading || failed) return;
    if (sets.length === 0) {
      if (value !== null) onChange(null);
      if (!prompted.current) {
        prompted.current = true;
        setSheet({ mode: "add" });
      }
      return;
    }
    // Keep the member's pick while it is still one of theirs; otherwise the default.
    if (value && sets.some((s) => s.id === value)) return;
    onChange((sets.find((s) => s.is_default) ?? sets[0]!).id);
  }, [loading, failed, sets, value, onChange]);

  async function saved(set: BillingDetails) {
    setSheet(null);
    await refetch();
    onChange(set.id);
  }

  return (
    <div className="mt-4 pb-4 border-b border-ink/5">
      <p className="text-sm font-medium text-ink mb-1">Bill to</p>
      {loading ? (
        <p className="text-xs text-muted py-3">Loading…</p>
      ) : failed ? (
        <div className="py-2">
          <p role="alert" className="text-sm text-error">
            We couldn&apos;t load your billing details.
          </p>
          <button
            type="button"
            onClick={() => void retry()}
            className="mt-1 inline-flex min-h-[44px] items-center text-sm font-medium text-accent-deep hover:underline"
          >
            Try again
          </button>
        </div>
      ) : (
        <>
          <p className="text-xs text-muted mb-3">
            {sets.length === 0
              ? "Add the name and address your receipt is made out to. You only need to do this once."
              : "The name and address your receipt is made out to."}
          </p>
          <div className="space-y-2">
            {sets.map((set) => (
              <div
                key={set.id}
                className={cn(
                  "flex items-start gap-3 rounded-xl border px-4 py-3 transition-colors",
                  value === set.id ? "border-accent-deep bg-accent/10" : "border-ink/10 hover:border-accent",
                )}
              >
                <label className="flex flex-1 min-w-0 items-start gap-3 cursor-pointer">
                  <input
                    type="radio"
                    name="bill-to"
                    value={set.id}
                    checked={value === set.id}
                    onChange={() => onChange(set.id)}
                    className="mt-0.5 h-4 w-4 border-ink/30 text-accent focus:ring-accent"
                  />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-ink break-words">{set.name}</span>
                    <span className="mt-0.5 block text-xs text-muted break-words">
                      {addressLines(set).join(", ")}
                    </span>
                  </span>
                </label>
                <button
                  type="button"
                  onClick={() => setSheet({ mode: "edit", set })}
                  aria-label={`Edit ${set.name}`}
                  className="shrink-0 inline-flex min-h-[32px] items-center gap-1 text-xs text-muted hover:text-ink"
                >
                  <Pencil className="h-3.5 w-3.5" />
                  Edit
                </button>
              </div>
            ))}
          </div>
          {sets.length < BILLING_DETAILS_LIMIT && (
            <button
              type="button"
              onClick={() => setSheet({ mode: "add" })}
              className="mt-2 inline-flex min-h-[44px] items-center gap-1.5 text-sm font-medium text-accent-deep hover:underline"
            >
              <Plus className="h-4 w-4" />
              {sets.length === 0 ? "Add billing details" : "Add another"}
            </button>
          )}
        </>
      )}

      {sheet && (
        <BillingDetailsSheet
          editing={sheet.mode === "edit" ? sheet.set : undefined}
          defaultName={sets.length === 0 ? ownName : ""}
          onSaved={saved}
          onClose={() => setSheet(null)}
        />
      )}
    </div>
  );
}
