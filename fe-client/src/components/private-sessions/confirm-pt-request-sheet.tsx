"use client";

import { useRouter } from "next/navigation";
import { CalendarClock, Loader2, MapPin, Sparkles, UsersRound } from "lucide-react";
import { Portal } from "@/components/ui/portal";
import {
  BTN_PRIMARY,
  BTN_SECONDARY,
  NOTE,
  SHEET_ACTIONS,
  SHEET_BACKDROP,
  SHEET_HANDLE,
  SHEET_PANEL,
  SHEET_TEXT,
  SHEET_TITLE,
} from "@/components/ui/styles";
import { cn, formatDate } from "@/lib/utils";
import { formatSlotTime } from "@/lib/pt-sessions";
import { sessionTypeLabel, sessionsWord, type PtPickRow } from "@/lib/pt-package-picker";
import type { LivePackage } from "@/lib/use-client-packages";
import { useBodyScrollLock } from "@/lib/use-body-scroll-lock";
import { useFocusTrap } from "@/lib/use-focus-trap";

export interface PtRequestSummary {
  sessionType: "1on1" | "2on1";
  locationName: string | null;
  /** Null is "any class type". */
  classTypeName: string | null;
  slots: { proposedDate: string; startTime: string }[];
  partnerName: string | null;
}

/** `2026-10-01` + `09:00` → "Thu, 1 Oct · 9:00 am". Noon UTC keeps the day the member picked. */
export function slotLabel(s: { proposedDate: string; startTime: string }): string {
  return `${formatDate(`${s.proposedDate}T12:00:00Z`)} · ${formatSlotTime(s.startTime)}`;
}

/**
 * "Send this request?" — the PT request's Book sheet (fe-client-features §5.2),
 * asked before anything is debited, as the class Book sheet is: what is being
 * asked for, and which PT package pays for it. The first package that can pay
 * starts ticked, so sending stays one tap; one without enough sessions is
 * greyed with the reason. The package decides the instructor when it is bound
 * to one, so the sheet says so.
 */
export function ConfirmPtRequestSheet({
  summary,
  rows,
  picked,
  onPick,
  cost,
  sending,
  error,
  onConfirm,
  onClose,
}: {
  summary: PtRequestSummary;
  rows: PtPickRow<LivePackage>[];
  picked: string | null;
  onPick: (id: string) => void;
  cost: number;
  sending: boolean;
  error: string | null;
  onConfirm: (clientPackageId: string) => void;
  onClose: () => void;
}) {
  const trapRef = useFocusTrap<HTMLDivElement>(true);
  useBodyScrollLock(true);
  const router = useRouter();
  const close = () => !sending && onClose();
  const pickedRow = rows.find((r) => r.pkg.id === picked && r.eligible) ?? null;
  const type = sessionTypeLabel(summary.sessionType);
  const blocked = !rows.some((r) => r.eligible)
    ? rows.length === 0
      ? `You don't have a ${type} PT package yet.`
      : `None of your ${type} packages has ${sessionsWord(cost)} left.`
    : null;

  return (
    <Portal>
      <div className={SHEET_BACKDROP} onClick={close}>
        <div
          ref={trapRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirm-pt-request"
          tabIndex={-1}
          className={SHEET_PANEL}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.key === "Escape" && close()}
        >
          <span aria-hidden className={SHEET_HANDLE} />
          <h3 id="confirm-pt-request" className={SHEET_TITLE}>
            Request a {type} session?
          </h3>

          <div className="mt-2 space-y-1.5 text-sm text-muted">
            {summary.locationName && (
              <p className="flex items-center gap-1.5">
                <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden />
                {summary.locationName}
              </p>
            )}
            <p className="flex items-center gap-1.5">
              <Sparkles className="h-3.5 w-3.5 shrink-0" aria-hidden />
              {summary.classTypeName ?? "Any class type"}
            </p>
            {summary.partnerName && (
              <p className="flex items-center gap-1.5">
                <UsersRound className="h-3.5 w-3.5 shrink-0" aria-hidden />
                With {summary.partnerName}
              </p>
            )}
            <div className="flex items-start gap-1.5">
              <CalendarClock className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
              <ul className="space-y-0.5 tabular-nums text-ink/80">
                {summary.slots.map((s, i) => (
                  <li key={i}>{slotLabel(s)}</li>
                ))}
              </ul>
            </div>
          </div>

          {rows.length > 0 && (
            <fieldset className="mt-4" disabled={sending}>
              <legend className="mb-2 text-sm font-medium text-ink">Pay with</legend>
              <div className="space-y-2">
                {rows.map(({ pkg, eligible, reason, meta }) => {
                  const checked = pickedRow?.pkg.id === pkg.id;
                  return (
                    <label
                      key={pkg.id}
                      className={cn(
                        "flex items-start gap-3 rounded-xl border px-4 py-3 transition-colors",
                        !eligible
                          ? "cursor-not-allowed border-ink/10 opacity-60"
                          : checked
                            ? "cursor-pointer border-accent-deep bg-accent/10 focus-within:ring-2 focus-within:ring-accent"
                            : "cursor-pointer border-ink/10 hover:border-accent focus-within:ring-2 focus-within:ring-accent",
                      )}
                    >
                      <input
                        type="radio"
                        name="pt-pay-with"
                        value={pkg.id}
                        checked={checked}
                        disabled={!eligible}
                        onChange={() => onPick(pkg.id)}
                        className="mt-0.5 h-4 w-4 border-ink/30 text-accent focus:ring-accent"
                      />
                      <span className="min-w-0">
                        <span className="block text-sm font-medium text-ink break-words">{pkg.name}</span>
                        <span className="block text-xs text-muted">{meta}</span>
                        {pkg.boundInstructor && (
                          <span className="mt-0.5 block text-xs font-medium text-accent-deep">
                            Sessions with {pkg.boundInstructor.name}
                          </span>
                        )}
                        {reason && <span className="mt-0.5 block text-xs text-ink/70">{reason}</span>}
                      </span>
                    </label>
                  );
                })}
              </div>
            </fieldset>
          )}

          {blocked ? (
            <p className={`${NOTE} mt-4`}>{blocked}</p>
          ) : (
            <p className={`${NOTE} mt-4 font-semibold`}>
              Uses {sessionsWord(cost)}
              {pickedRow ? ` from ${pickedRow.pkg.name}` : ""}
            </p>
          )}
          <p className={SHEET_TEXT}>
            The studio confirms the time with you on WhatsApp. Cancel while it&apos;s pending and the{" "}
            {cost === 1 ? "session goes" : "sessions go"} back to your package.
          </p>

          {error && (
            <p className="mt-3 rounded-xl border border-error/30 bg-error/10 px-4 py-3 text-sm text-error" role="alert">
              {error}
            </p>
          )}

          <div className={SHEET_ACTIONS}>
            <button type="button" onClick={close} disabled={sending} className={BTN_SECONDARY}>
              Not now
            </button>
            {blocked ? (
              <button type="button" onClick={() => router.push("/packages#private")} className={BTN_PRIMARY}>
                See packages
              </button>
            ) : (
              <button
                type="button"
                onClick={() => pickedRow && onConfirm(pickedRow.pkg.id)}
                disabled={sending || !pickedRow}
                className={BTN_PRIMARY}
              >
                {sending && <Loader2 className="h-4 w-4 animate-spin" />}
                {sending ? "Sending…" : "Send request"}
              </button>
            )}
          </div>
        </div>
      </div>
    </Portal>
  );
}
