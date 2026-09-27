"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, MapPin, UserRound } from "lucide-react";
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
import { cn, formatDate, formatSgd } from "@/lib/utils";
import { apiErrorCode, useApi } from "@/lib/api";
import { ERROR_CODES } from "@/lib/error-codes";
import { fetchMemberClass, formatClassTime, type ApiClassCard } from "@/lib/classes";
import {
  activationLine,
  costLine,
  initialPick,
  nothingEligibleCopy,
  packageMeta,
  reasonText,
  type MyClassPackage,
} from "@/lib/package-picker";
import { ruleSentence, type ApiPackageRule } from "@/lib/package-rule";
import { useBodyScrollLock } from "@/lib/use-body-scroll-lock";
import { useFocusTrap } from "@/lib/use-focus-trap";
import { useCancellationPolicy } from "@/lib/cancellation-policy";
import { classBookingPolicy } from "@/lib/cancellation-copy";

type Load =
  | { state: "loading" }
  | { state: "error"; msg: string }
  | { state: "ready"; packages: MyClassPackage[]; rule: ApiPackageRule };

/**
 * "Book this class?" — asked before a booking spends anything, so a stray tap
 * on a row never costs a credit. It is also where the member picks which of
 * their class packages pays (be/docs/adr/0010): the Default payer starts
 * ticked, so booking stays one tap, and a package that cannot pay for this
 * class is greyed with the reason. States what the booking costs and how late
 * it can be cancelled, the two things a member can't take back by closing the
 * tab.
 */
export function ConfirmBookingSheet({
  cls,
  booking,
  addOnRateSgd,
  onConfirm,
  onClose,
}: {
  cls: ApiClassCard;
  booking: boolean;
  /** The Cross-Location Add-On's rate, from the entitlements; null while unknown. */
  addOnRateSgd: string | null;
  /** Book, paid by the picked package. `choices` is how many packages the sheet listed. */
  onConfirm: (clientPackageId: string, choices: number) => void;
  onClose: () => void;
}) {
  const trapRef = useFocusTrap<HTMLDivElement>(true);
  useBodyScrollLock(true);
  const policy = useCancellationPolicy();
  const api = useApi();
  const router = useRouter();
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [picked, setPicked] = useState<string | null>(null);
  const close = () => !booking && onClose();

  const read = useCallback(
    async (isCancelled: () => boolean) => {
      setLoad({ state: "loading" });
      try {
        const detail = await fetchMemberClass(api, cls.id);
        if (isCancelled()) return;
        setPicked(initialPick(detail));
        setLoad({ state: "ready", packages: detail.my_packages, rule: detail.package_rule });
      } catch (err) {
        if (isCancelled()) return;
        setLoad({
          state: "error",
          msg:
            apiErrorCode(err) === ERROR_CODES.class_not_found
              ? "This class is no longer running."
              : "We couldn't load your packages. Please try again.",
        });
      }
    },
    [api, cls.id],
  );

  useEffect(() => {
    let cancelled = false;
    void read(() => cancelled);
    return () => {
      cancelled = true;
    };
  }, [read]);

  const packages = load.state === "ready" ? load.packages : [];
  // Named only when the class takes some packages and not others: that is why
  // a row may be greyed "Not accepted for this class".
  const rule = load.state === "ready" && load.rule.mode !== "all" ? load.rule : null;
  const pickedPkg = packages.find((p) => p.id === picked && p.eligible) ?? null;
  const blocked = load.state === "ready" ? nothingEligibleCopy(packages) : null;
  // Held back until the rate has loaded, so the link never quotes S$0.
  const offerAddOn = !!cls.location && Number(addOnRateSgd) > 0;

  return (
    <Portal>
      <div className={SHEET_BACKDROP} onClick={close}>
        <div
          ref={trapRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={`confirm-book-${cls.id}`}
          tabIndex={-1}
          className={SHEET_PANEL}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.key === "Escape" && close()}
        >
          <span aria-hidden className={SHEET_HANDLE} />
          <h3 id={`confirm-book-${cls.id}`} className={SHEET_TITLE}>
            Book {cls.class_type.name}?
          </h3>
          <p className="mt-1 text-sm font-medium text-ink/80 tabular-nums">
            {formatDate(cls.starts_at)} · {formatClassTime(cls.starts_at)} – {formatClassTime(cls.ends_at)}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
            {cls.location && (
              <span className="inline-flex items-center gap-1 min-w-0">
                <MapPin className="h-3.5 w-3.5 shrink-0" />
                {cls.location.name}
              </span>
            )}
            <span className="inline-flex items-center gap-1 min-w-0">
              <UserRound className="h-3.5 w-3.5 shrink-0" />
              {cls.instructor.name}
            </span>
          </div>

          {load.state === "loading" ? (
            <p className="mt-4 inline-flex items-center gap-2 text-sm text-muted" role="status">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              Loading your packages…
            </p>
          ) : load.state === "error" ? (
            <div className="mt-4 rounded-xl border border-error/30 bg-error/10 px-4 py-3 text-sm text-error" role="alert">
              {load.msg}{" "}
              <button
                type="button"
                onClick={() => void read(() => false)}
                className="font-medium underline underline-offset-2"
              >
                Try again
              </button>
            </div>
          ) : (
            <>
              {packages.length > 0 && (
                <fieldset className="mt-4" disabled={booking}>
                  <legend className="mb-2 text-sm font-medium text-ink">Pay with</legend>
                  {rule && (
                    <p className="-mt-1 mb-2 text-xs text-muted">This class accepts: {ruleSentence(rule)}</p>
                  )}
                  <div className="space-y-2">
                    {packages.map((p) => {
                      const checked = pickedPkg?.id === p.id;
                      const reason = reasonText(p);
                      const starts = checked ? activationLine(p) : null;
                      return (
                        <div key={p.id}>
                          <label
                            className={cn(
                              "flex items-start gap-3 rounded-xl border px-4 py-3 transition-colors",
                              !p.eligible
                                ? "cursor-not-allowed border-ink/10 opacity-60"
                                : checked
                                  ? "cursor-pointer border-accent-deep bg-accent/10 focus-within:ring-2 focus-within:ring-accent"
                                  : "cursor-pointer border-ink/10 hover:border-accent focus-within:ring-2 focus-within:ring-accent",
                            )}
                          >
                            <input
                              type="radio"
                              name={`pay-with-${cls.id}`}
                              value={p.id}
                              checked={checked}
                              disabled={!p.eligible}
                              onChange={() => setPicked(p.id)}
                              className="mt-0.5 h-4 w-4 border-ink/30 text-accent focus:ring-accent"
                            />
                            <span className="min-w-0">
                              <span className="block text-sm font-medium text-ink break-words">{p.name}</span>
                              <span className="block text-xs text-muted">{packageMeta(p)}</span>
                              {starts && (
                                <span className="mt-0.5 block text-xs font-medium text-accent-deep">{starts}</span>
                              )}
                              {reason && <span className="mt-0.5 block text-xs text-ink/70">{reason}</span>}
                            </span>
                          </label>
                          {/* The Add-On beside a plan homed elsewhere: the way
                              to make that plan Cover this studio too (§5). */}
                          {p.reason === "location_not_covered" && offerAddOn && cls.location && (
                            <Link
                              href={`/checkout?add_on=${p.id}`}
                              className="mt-1 ml-11 inline-block text-xs text-muted underline underline-offset-2 hover:text-ink transition-colors"
                            >
                              Add {cls.location.name} for {formatSgd(addOnRateSgd!)}/month
                            </Link>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </fieldset>
              )}
              {blocked ? (
                <p className={`${NOTE} mt-4`}>{blocked}</p>
              ) : (
                <p className={`${NOTE} mt-4 font-semibold`}>{costLine(pickedPkg, cls.credit_cost)}</p>
              )}
            </>
          )}

          {policy && (
            <p className={SHEET_TEXT}>{classBookingPolicy(policy, cls.effective_cancel_window_hours)}</p>
          )}
          <div className={SHEET_ACTIONS}>
            <button type="button" onClick={close} disabled={booking} className={BTN_SECONDARY}>
              Not now
            </button>
            {blocked ? (
              <button type="button" onClick={() => router.push("/packages")} className={BTN_PRIMARY}>
                See packages
              </button>
            ) : (
              <button
                type="button"
                onClick={() => pickedPkg && onConfirm(pickedPkg.id, packages.length)}
                disabled={booking || !pickedPkg}
                className={BTN_PRIMARY}
              >
                {booking && <Loader2 className="h-4 w-4 animate-spin" />}
                {booking ? "Booking…" : "Book class"}
              </button>
            )}
          </div>
        </div>
      </div>
    </Portal>
  );
}
