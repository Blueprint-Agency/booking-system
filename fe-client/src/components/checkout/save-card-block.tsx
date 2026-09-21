"use client";

/**
 * "Save this card for next time" at checkout (#185).
 *
 * The box is ours rather than the payment page's, for a version reason: the
 * API version this platform pins predates the provider's own save-this-card
 * control. So consent is collected here and carried to the server, which is
 * the only thing that turns card-saving on for a session.
 *
 * **Unticked by default, and it stays unticked.** Nothing about a card is kept
 * because a member did not notice a box — that is the difference between a
 * convenience and a surprise, and a saved card is somebody's money.
 *
 * It says where the card is kept, because "we save your card" reads as *we*
 * hold the number and that is not what happens: the number goes to the payment
 * provider and never touches this app. A member who thinks otherwise is being
 * asked to consent to something other than what they are consenting to.
 */
import { CreditCard } from "lucide-react";

export function SaveCardBlock({
  checked,
  onCheckedChange,
  /**
   * Is this the second card on a purchase already part paid? Only the sentence
   * changes — the member is here precisely because they paid once already, so
   * saying what it saves them is worth the extra clause.
   */
  resuming = false,
  /**
   * Is this checkout already card-only for another reason — a Part Payment?
   *
   * Then the cards-only notice below is somebody else's to print, and printing
   * it twice reads as two separate restrictions rather than the one that is
   * actually in force.
   */
  alreadyCardOnly = false,
}: {
  checked: boolean;
  onCheckedChange: (next: boolean) => void;
  resuming?: boolean;
  alreadyCardOnly?: boolean;
}) {
  return (
    <div className="mt-4">
      <label className="flex items-start gap-3 cursor-pointer">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onCheckedChange(e.target.checked)}
          className="mt-0.5 h-4 w-4 rounded border-ink/30 text-accent focus:ring-accent"
        />
        <span className="min-w-0">
          <span className="block text-sm font-medium text-ink">
            Save this card for next time
          </span>
          <span className="mt-0.5 block text-xs text-muted">
            {resuming
              ? "Pick it on the payment page instead of typing the number again."
              : "Next time you can pick it instead of typing the number again."}{" "}
            Your card is stored by our payment provider, never by us, and you can
            remove it from your profile whenever you like.
          </span>
        </span>
      </label>
      <p className="mt-2 flex items-start gap-2 text-[11px] text-muted">
        <CreditCard className="mt-0.5 h-3 w-3 shrink-0" />
        <span>
          We never see or hold your card number — only the last four digits, so
          you can tell your cards apart.
        </span>
      </p>

      {/* Saving the card makes this checkout card-only, because a card is the
          only thing there is to save. Said here, before the member commits to
          it, rather than discovered as a missing button on the payment page. */}
      {checked && !alreadyCardOnly && (
        <div className="mt-3 flex items-start gap-2 rounded-xl border border-ink/10 bg-warm px-3 py-2.5 text-xs text-ink">
          <CreditCard className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted" />
          <span>
            Saving a card makes this payment{" "}
            <span className="font-medium">card only</span> — PayNow is not
            available when you keep a card. Untick this to pay with PayNow.
          </span>
        </div>
      )}
    </div>
  );
}
