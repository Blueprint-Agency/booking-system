"use client";

/**
 * Part Payment at checkout (#93).
 *
 * On "Full payment" (the default) the checkout behaves exactly as it always
 * has. On "Partial payment", the member says what this card will take —
 * because a card at its daily limit declines the whole charge and nothing can
 * read that limit in advance, so they are the only party who knows.
 *
 * The field is pre-filled with the full price and edited **downward**. Asking
 * for more than is owed is refused by the server rather than quietly reduced,
 * and this component does not try to be clever about it either: it shows what
 * the server said.
 *
 * The two sentences under the field are not decoration. A part-paid purchase
 * grants nothing and holds no workshop place, and a member who learns that
 * after paying has been misled by the interface, not by the studio.
 */
import { AlertCircle, CreditCard } from "lucide-react";
import { cn, formatCurrency } from "@/lib/utils";

export function PartPaymentBlock({
  enabled,
  checked,
  onCheckedChange,
  amount,
  onAmountChange,
  totalSgd,
  floorSgd,
  isWorkshop,
}: {
  /** The studio offers it. Off means this renders nothing at all. */
  enabled: boolean;
  checked: boolean;
  onCheckedChange: (next: boolean) => void;
  /** What the member typed, as they typed it — validated on the server. */
  amount: string;
  onAmountChange: (next: string) => void;
  totalSgd: number;
  floorSgd: string;
  /** A workshop place is not held until the balance is cleared. */
  isWorkshop: boolean;
}) {
  if (!enabled) return null;

  const typed = Number(amount);
  const remainder = Number.isFinite(typed) ? totalSgd - typed : 0;

  return (
    <fieldset className="mt-4 pb-4 border-b border-ink/5">
      <legend className="text-sm font-medium text-ink mb-2">How much to pay now</legend>
      {/* Two named choices rather than one checkbox: paying in full is a choice
          too, and a member should see both before picking. */}
      <div className="grid grid-cols-2 gap-2">
        {[
          { split: false, title: "Full payment", detail: formatCurrency(totalSgd) },
          { split: true, title: "Partial payment", detail: "Pay the rest later" },
        ].map(option => (
          <label
            key={option.title}
            className={cn(
              "flex items-start gap-2.5 rounded-xl border px-3.5 py-3 cursor-pointer transition-colors focus-within:ring-2 focus-within:ring-accent",
              checked === option.split
                ? "border-accent-deep bg-accent/10"
                : "border-ink/10 hover:border-accent",
            )}
          >
            <input
              type="radio"
              name="part-payment"
              checked={checked === option.split}
              onChange={() => onCheckedChange(option.split)}
              className="mt-0.5 h-4 w-4 border-ink/30 text-accent focus:ring-accent"
            />
            <span className="min-w-0">
              <span className="block text-sm font-medium text-ink">{option.title}</span>
              <span className="block text-xs text-muted">{option.detail}</span>
            </span>
          </label>
        ))}
      </div>
      {!checked && (
        <p className="mt-2 text-xs text-muted">
          If your card has a daily limit below {formatCurrency(totalSgd)}, make a
          partial payment now and pay the rest with another card.
        </p>
      )}

      {checked && (
        <div className="mt-3 space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted">S$</span>
            <input
              type="number"
              inputMode="decimal"
              min={floorSgd}
              max={totalSgd}
              step="0.01"
              value={amount}
              onChange={e => onAmountChange(e.target.value)}
              className="w-36 min-h-[44px] rounded-xl border border-ink/10 bg-paper px-3 py-2.5 text-sm tabular-nums focus:border-accent focus:outline-none transition-colors"
              aria-label="Amount to pay now"
            />
            <span className="text-xs text-muted">
              of {formatCurrency(totalSgd)}
            </span>
          </div>

          {remainder > 0 && (
            <p className="text-xs text-muted">
              {formatCurrency(remainder)} left to pay. It will be waiting on your
              account page, and stays open until it&apos;s paid in full or refunded
              by the studio.
            </p>
          )}

          <div className="flex items-start gap-2 rounded-xl border border-ink/10 bg-warm px-3 py-2.5 text-xs text-ink">
            <CreditCard className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted" />
            <span>
              A part payment means you can only pay{" "}
              <span className="font-medium">by card</span> this time.
            </span>
          </div>

          <div className="flex items-start gap-2 rounded-xl border border-warning/30 bg-warning/10 px-3 py-2.5 text-xs text-ink">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
            <span>
              {isWorkshop
                ? "Your place is not reserved until the balance is paid in full."
                : "Nothing is added to your account until the balance is paid in full."}
            </span>
          </div>
        </div>
      )}
    </fieldset>
  );
}
