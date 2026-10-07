"use client";

import { useId, useState } from "react";
import { ChevronDown } from "lucide-react";
import { useApi } from "@/lib/api";
import { movementText, type CreditHistory } from "@/lib/credit-history";
import { cn, formatDate, formatExpiryDate } from "@/lib/utils";

/**
 * "Credit history" on a package in My packages (#353): where its credits (or
 * sessions) went — each booking that spent one, each cancel that returned or
 * kept it, an expiry, a studio adjustment — newest first, with what was left
 * after each. Read when opened, not with the page.
 */
export function CreditHistoryDisclosure({ packageId, unit }: { packageId: string; unit: "credit" | "session" }) {
  const api = useApi();
  const [open, setOpen] = useState(false);
  const [history, setHistory] = useState<CreditHistory | null>(null);
  const [failed, setFailed] = useState(false);
  const listId = useId();

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next) {
      setFailed(false);
      api
        .get<CreditHistory>(`/me/packages/${packageId}/credit-history`)
        .then(setHistory)
        .catch(() => setFailed(true));
    }
  };

  return (
    <div className="mt-3 border-t border-ink/5 pt-1">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={listId}
        onClick={toggle}
        className="flex min-h-[44px] w-full items-center gap-2 text-left text-sm font-semibold text-ink"
      >
        <span className="flex-1">Credit history</span>
        <ChevronDown className={cn("h-4 w-4 shrink-0 text-muted transition-transform", open && "rotate-180")} aria-hidden />
      </button>
      <div id={listId} hidden={!open}>
        {failed ? (
          <p className="pb-2 text-sm text-muted">Your credit history could not be loaded. Try again in a moment.</p>
        ) : !history ? (
          <p className="pb-2 text-sm text-muted">Loading…</p>
        ) : (
          <>
            {history.movements.length === 0 ? (
              <p className="pb-2 text-sm text-muted">Nothing has moved on this package yet.</p>
            ) : (
              <ul className="divide-y divide-ink/5">
                {history.movements.map((m) => {
                  const { text, balance } = movementText(m, unit);
                  const what = m.booking ? (m.booking.title ?? (m.booking.kind === "pt" ? "Private session" : "Booking")) : null;
                  return (
                    <li key={m.id} className="flex items-start gap-3 py-2 text-sm">
                      <span className="w-24 shrink-0 text-xs text-muted tabular-nums">{formatDate(m.at)}</span>
                      <span className="min-w-0 flex-1">
                        {what && <span className="block break-words text-ink">{what}</span>}
                        <span className={cn("block break-words", what ? "text-xs text-muted" : "text-ink")}>{text}</span>
                      </span>
                      {balance !== null && (
                        <span className="shrink-0 text-xs text-muted tabular-nums">{balance} left</span>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
            <p className="pb-2 pt-1 text-xs text-muted">History from {formatExpiryDate(history.history_from)}</p>
          </>
        )}
      </div>
    </div>
  );
}
