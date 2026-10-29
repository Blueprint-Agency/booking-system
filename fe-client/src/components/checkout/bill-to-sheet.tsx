"use client";

/**
 * Who a purchase with no review page is billed to: Merch, a S$0
 * package, workshop place or corporate package bought straight from its Buy
 * button, and the trial pass. Every purchase needs Billing details, free ones
 * included, so these paths stop here before they buy.
 *
 * It is the checkout picker in a sheet: the member's default selected, any
 * other one a tap away, a set added or edited in place. A member with none is
 * shown the add form at once; on save it is selected, and confirming carries
 * on with the very item they were buying, which never left the screen.
 */
import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Portal } from "@/components/ui/portal";
import {
  BTN_PRIMARY,
  BTN_SECONDARY,
  SHEET_ACTIONS,
  SHEET_BACKDROP,
  SHEET_HANDLE,
  SHEET_PANEL,
  SHEET_TEXT,
  SHEET_TITLE,
} from "@/components/ui/styles";
import { useBodyScrollLock } from "@/lib/use-body-scroll-lock";
import { useFocusTrap } from "@/lib/use-focus-trap";
import { BillingDetailsPicker } from "./billing-details-picker";

export function BillToSheet({
  item,
  confirmLabel,
  busy = false,
  onConfirm,
  onClose,
}: {
  /** What is being bought, as the member saw it on its card, where the caller knows it. */
  item?: string;
  /** The button that buys it: "Confirm your free purchase", "Continue to payment". */
  confirmLabel: string;
  busy?: boolean;
  onConfirm: (billingDetailsId: string) => void;
  onClose: () => void;
}) {
  const [billingDetailsId, setBillingDetailsId] = useState<string | null>(null);
  const trapRef = useFocusTrap<HTMLDivElement>(true);
  useBodyScrollLock(true);

  return (
    <Portal>
      <div className={SHEET_BACKDROP} onClick={() => !busy && onClose()}>
        <div
          ref={trapRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="bill-to-title"
          tabIndex={-1}
          className={SHEET_PANEL}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            // The add/edit form opens over this sheet and its keys bubble here
            // through React; Escape there closes that form, not this sheet too.
            if (e.key !== "Escape" || busy) return;
            if (trapRef.current?.contains(e.target as Node)) onClose();
          }}
        >
          <span aria-hidden className={SHEET_HANDLE} />
          <h3 id="bill-to-title" className={SHEET_TITLE}>
            Billing details
          </h3>
          <p className={SHEET_TEXT}>
            Who your receipt for{" "}
            {item ? <span className="font-medium text-ink">{item}</span> : "this purchase"} is made out to.
          </p>

          <BillingDetailsPicker value={billingDetailsId} onChange={setBillingDetailsId} />

          <div className={SHEET_ACTIONS}>
            <button type="button" onClick={onClose} disabled={busy} className={BTN_SECONDARY}>
              Cancel
            </button>
            <button
              type="button"
              disabled={!billingDetailsId || busy}
              onClick={() => billingDetailsId && onConfirm(billingDetailsId)}
              className={BTN_PRIMARY}
            >
              {busy && <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />}
              {billingDetailsId ? confirmLabel : "Add your billing details to continue"}
            </button>
          </div>
        </div>
      </div>
    </Portal>
  );
}
