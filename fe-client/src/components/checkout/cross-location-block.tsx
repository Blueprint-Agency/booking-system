"use client";

import Link from "next/link";
import { MapPin } from "lucide-react";
import { cn, formatCurrency, formatSgd } from "@/lib/utils";

/**
 * Why the Add-On cannot be taken right now. Greyed copy is always a
 * precondition, never "Unavailable" — the rate stays visible while disabled, so
 * the greyed state advertises rather than reads as broken (spec §12).
 */
export type AddOnDisabledReason = "no_home_location" | "already_added" | "no_plan";

export function CrossLocationBlock({
  rateSgd,
  months,
  otherLocations,
  checked,
  onChange,
  disabledReason,
  remainder,
}: {
  /** The Global Policy rate, as the server states it. Never derived here. */
  rateSgd: string;
  /** Whole months the Add-On is priced by — the server's number, not this app's. */
  months: number;
  /** The Location(s) the plan does not already Cover. */
  otherLocations: string[];
  checked: boolean;
  /**
   * Omitted on the standalone purchase, where the Add-On IS the order rather
   * than an option on one — so the block states it instead of offering a
   * checkbox that refuses to be unticked.
   */
  onChange?: (next: boolean) => void;
  disabledReason?: AddOnDisabledReason | null;
  /**
   * The part-months sentence, shown BEFORE the arithmetic so the surprising part
   * is answered before the number that provokes the question (§12). Absent on a
   * Dormant plan, which prices at its full stored Duration with nothing to round.
   */
  remainder?: string | null;
}) {
  const where = otherLocations.length ? otherLocations.join(" and ") : "the other studio";
  // A commented mirror of `crossLocationPriceSgd` in
  // `be/src/services/packages/validity.ts` — cents, so the arithmetic cannot
  // drift. It only shows the member the sum; the server prices the charge.
  const total = (Math.round(Number(rateSgd) * 100) * months) / 100;
  const disabled = Boolean(disabledReason);
  // A label only where there is a control to label.
  const Wrapper = onChange ? "label" : "div";

  return (
    <div className={cn("mt-4 pb-4 border-b border-ink/5", disabled && "opacity-70")}>
      <Wrapper
        className={cn(
          "flex items-start gap-3 rounded-xl border px-4 py-3 transition-colors",
          disabled || !onChange
            ? "border-ink/10 cursor-default"
            : "cursor-pointer",
          disabled
            ? "bg-warm"
            : checked
              ? "border-accent-deep bg-accent/10"
              : "border-ink/10 hover:border-accent",
        )}
      >
        {onChange && (
          <input
            type="checkbox"
            checked={checked}
            disabled={disabled}
            onChange={(e) => onChange(e.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-ink/30 text-accent focus:ring-accent disabled:cursor-not-allowed"
          />
        )}
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium text-ink">
            Cross-Location Add-On
            <span className="ml-2 font-normal text-muted">{formatSgd(rateSgd)}/month</span>
          </span>

          {disabled ? (
            // A precondition in place of the price, and the rate above still showing.
            <span className="mt-1 block text-xs text-muted">
              {disabledReason === "no_home_location" && "Pick your home studio first."}
              {disabledReason === "already_added" && "This plan already covers both studios."}
              {disabledReason === "no_plan" && (
                <>
                  This attaches to an Unlimited plan, and you don&apos;t have one yet.{" "}
                  <Link href="/packages" className="underline underline-offset-2 hover:text-ink">
                    See the plans
                  </Link>
                </>
              )}
            </span>
          ) : (
            <>
              <span className="mt-1 flex items-start gap-1 text-xs text-muted">
                <MapPin className="h-3 w-3 shrink-0 mt-0.5" />
                Also practise at {where}.
              </span>
              {remainder && <span className="mt-1.5 block text-xs text-muted">{remainder}</span>}
              <span className="mt-1.5 block text-sm text-ink tabular-nums">
                {months} month{months === 1 ? "" : "s"} × {formatSgd(rateSgd)} ={" "}
                <span className="font-semibold">{formatCurrency(total)}</span>
              </span>
            </>
          )}

          <span className="mt-1.5 block text-xs text-muted">
            Expires with the plan it&apos;s attached to.
          </span>
        </span>
      </Wrapper>
    </div>
  );
}
