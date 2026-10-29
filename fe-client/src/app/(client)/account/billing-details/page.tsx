"use client";

/**
 * The member's Billing details: the up-to-three names and addresses
 * their receipts are made out to, one of them the default that checkout picks.
 *
 * Add, edit, delete and make-default, each sent to the backend and the list
 * read back afterwards — the backend decides which set is the default after a
 * delete (the most recently added one left), so the page never guesses.
 */
import { useState } from "react";
import { AlertCircle, Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { AccountPageHeader } from "@/components/account/account-page-header";
import { BillingDetailsSheet } from "@/components/account/billing-details-sheet";
import { ContentLoading } from "@/components/ui/content-loading";
import { BTN_PRIMARY, CARD } from "@/components/ui/styles";
import { useApi } from "@/lib/api";
import { useAppUser } from "@/lib/auth";
import {
  addressLines,
  BILLING_DETAILS_LIMIT,
  billingDetailsError,
  deleteBillingDetails,
  makeDefaultBillingDetails,
  useBillingDetails,
  type BillingDetails,
} from "@/lib/billing-details";
import { reportError } from "@/lib/report-error";

type Sheet = { mode: "add" } | { mode: "edit"; set: BillingDetails } | null;

export default function BillingDetailsPage() {
  const { sets, loading, failed, refetch } = useBillingDetails();
  const { user } = useAppUser();
  const [sheet, setSheet] = useState<Sheet>(null);
  const full = sets.length >= BILLING_DETAILS_LIMIT;
  // The common case — billing themselves — takes no typing on the first set.
  const ownName = user ? `${user.firstName} ${user.lastName}`.trim() : "";

  async function saved() {
    setSheet(null);
    await refetch();
  }

  return (
    <div>
      <AccountPageHeader
        title="Billing details"
        description="The names and addresses your receipts are made out to. Keep up to three — yourself, your company — and choose one at checkout."
        action={
          !loading && !failed && sets.length > 0 && !full ? (
            <button type="button" onClick={() => setSheet({ mode: "add" })} className={BTN_PRIMARY}>
              <Plus className="h-4 w-4" />
              Add
            </button>
          ) : undefined
        }
      />

      <div className="max-w-3xl space-y-4">
        {loading ? (
          <ContentLoading label="Loading your billing details" className="min-h-32" />
        ) : failed ? (
          <div className="flex items-start gap-2 rounded-xl border border-ink/10 bg-warm px-4 py-3 text-sm text-ink">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-muted" />
            <span>
              We couldn&apos;t load your billing details just now. Refresh the page —
              nothing has changed.
            </span>
          </div>
        ) : sets.length === 0 ? (
          <section className={`${CARD} p-5 sm:p-6`}>
            <h2 className="text-base font-bold text-ink">No billing details yet</h2>
            <p className="mt-1 text-sm text-muted">
              Add the name and address you&apos;d like on your receipts. You&apos;ll be
              asked for one before your next purchase.
            </p>
            <button
              type="button"
              onClick={() => setSheet({ mode: "add" })}
              className={`${BTN_PRIMARY} mt-4`}
            >
              <Plus className="h-4 w-4" />
              Add billing details
            </button>
          </section>
        ) : (
          <>
            <ul className="space-y-3">
              {sets.map((set) => (
                <BillingDetailsRow
                  key={set.id}
                  set={set}
                  onEdit={() => setSheet({ mode: "edit", set })}
                  onChanged={refetch}
                />
              ))}
            </ul>
            {full && (
              <p className="text-sm text-muted">
                You have {BILLING_DETAILS_LIMIT}, the most you can keep. Edit or delete
                one to add another.
              </p>
            )}
          </>
        )}
      </div>

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

function BillingDetailsRow({
  set,
  onEdit,
  onChanged,
}: {
  set: BillingDetails;
  onEdit: () => void;
  onChanged: () => Promise<void>;
}) {
  const api = useApi();
  const [busy, setBusy] = useState<"default" | "delete" | null>(null);
  const [confirming, setConfirming] = useState(false);

  async function run(kind: "default" | "delete") {
    setBusy(kind);
    try {
      if (kind === "default") await makeDefaultBillingDetails(api, set.id);
      else await deleteBillingDetails(api, set.id);
      await onChanged();
    } catch (err) {
      reportError(err, { scope: kind === "default" ? "default-billing-details" : "delete-billing-details" });
      toast.error(
        billingDetailsError(
          err,
          kind === "default"
            ? "Couldn't make that your default. Please try again."
            : "Couldn't delete those billing details. Please try again.",
        ),
      );
    } finally {
      // Cleared on both paths: the refetch may still list the row.
      setBusy(null);
      setConfirming(false);
    }
  }

  const action =
    "inline-flex min-h-[40px] items-center justify-center gap-1.5 rounded-full border border-ink/10 px-4 text-sm font-semibold text-ink hover:border-ink/30 transition-colors disabled:opacity-50";

  return (
    <li className={`${CARD} p-4 sm:p-5`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-bold text-ink break-words">{set.name}</p>
          <address className="mt-1 not-italic text-sm text-muted leading-relaxed break-words">
            {addressLines(set).map((line, i) => (
              <span key={i} className="block">
                {line}
              </span>
            ))}
          </address>
        </div>
        {set.is_default && (
          <span className="shrink-0 rounded-full bg-accent/10 px-2.5 py-1 text-xs font-semibold text-accent-deep">
            Default
          </span>
        )}
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" onClick={onEdit} disabled={busy !== null} className={action}>
          Edit
        </button>
        {!set.is_default && (
          <button type="button" onClick={() => run("default")} disabled={busy !== null} className={action}>
            {busy === "default" && <Loader2 className="h-4 w-4 animate-spin" />}
            Make default
          </button>
        )}
        {confirming ? (
          <>
            <button
              type="button"
              onClick={() => run("delete")}
              disabled={busy !== null}
              className="inline-flex min-h-[40px] items-center justify-center gap-1.5 rounded-full bg-error px-4 text-sm font-semibold text-inverse hover:bg-error/90 transition-colors disabled:opacity-60"
            >
              {busy === "delete" && <Loader2 className="h-4 w-4 animate-spin" />}
              Confirm delete
            </button>
            <button type="button" onClick={() => setConfirming(false)} disabled={busy !== null} className={action}>
              Keep
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            disabled={busy !== null}
            className={`${action} hover:border-error hover:text-error`}
          >
            Delete
          </button>
        )}
      </div>
    </li>
  );
}
