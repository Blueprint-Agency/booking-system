"use client";

/**
 * The member's saved cards, on their profile page (#185).
 *
 * It sits beside "change password" rather than on the account overview because
 * it is account admin, not something waiting on the member — unlike an
 * unfinished purchase, which is why that list lives on the overview and this
 * does not.
 *
 * **There is no "add a card" button, and that is deliberate.** A card is kept
 * by ticking a box while paying, which is the only moment a member has a reason
 * to hand one over. A button here would have to open a payment page that takes
 * no money, which is a strange thing to be sent to and a worse thing to be
 * charged nothing by. So this screen lists and removes, and says where cards
 * come from.
 *
 * Removing is immediate and needs no confirmation dialog: nothing is lost that
 * cannot be put back by ticking the box on the next purchase, and a modal over
 * a reversible action is friction for its own sake.
 */
import { useState } from "react";
import { AlertCircle, CreditCard, Loader2, Trash2 } from "lucide-react";
import { useApi } from "@/lib/api";
import { reportError } from "@/lib/report-error";
import { cardBrandLabel, cardExpiry, type SavedCard } from "@/lib/saved-cards";
import { removeSavedCard, useSavedCards } from "@/lib/use-saved-cards";

const cardClass = "rounded-2xl bg-paper border border-ink/10 p-8";

export function SavedCardsCard() {
  const { cards, loading, failed, refetch } = useSavedCards();

  return (
    <section className={cardClass}>
      <div className="flex items-start gap-3">
        <CreditCard className="mt-0.5 h-5 w-5 shrink-0 text-muted" />
        <div className="min-w-0">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted">
            Saved cards
          </h2>
          <p className="mt-1 text-sm text-muted">
            Cards you chose to keep while paying. They are stored by our payment
            provider — we only ever see the last four digits.
          </p>
        </div>
      </div>

      <div className="mt-6">
        {loading ? (
          <p className="flex items-center gap-2 text-sm text-muted">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading your cards…
          </p>
        ) : failed ? (
          <div className="flex items-start gap-2 rounded-xl border border-ink/10 bg-warm px-4 py-3 text-sm text-ink">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-muted" />
            <span>
              We couldn&apos;t load your saved cards just now. Refresh the page —
              nothing has changed.
            </span>
          </div>
        ) : cards.length === 0 ? (
          <p className="text-sm text-muted">
            You haven&apos;t saved a card. Tick{" "}
            <span className="font-medium text-ink">
              &ldquo;Save this card for next time&rdquo;
            </span>{" "}
            when you next pay, and it will appear here.
          </p>
        ) : (
          <ul className="space-y-3">
            {cards.map((card) => (
              <SavedCardRow key={card.id} card={card} onRemoved={refetch} />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function SavedCardRow({
  card,
  onRemoved,
}: {
  card: SavedCard;
  onRemoved: () => void | Promise<void>;
}) {
  const api = useApi();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { label, expired } = cardExpiry(card);

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      await removeSavedCard(api, card.id);
      await onRemoved();
    } catch (err) {
      reportError(err, { scope: "remove-saved-card" });
      setError("Couldn't remove that card. Please try again.");
    } finally {
      // Cleared on **both** paths. The row usually unmounts on success, so a
      // success-path reset looks unnecessary — until the refetch still lists
      // the card (provider list lag, or a detach that worked while the read
      // after it did not), and the button is left disabled until a reload.
      setBusy(false);
    }
  }

  return (
    <li className="rounded-xl border border-ink/10 px-4 py-3">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm font-medium text-ink">
            {cardBrandLabel(card.brand)} ···· {card.last4}
          </p>
          <p className="mt-0.5 text-xs text-muted">
            {expired ? (
              // Said plainly rather than hidden. A card that will be declined is
              // worse to discover on the payment page than here.
              <span className="text-error">Expired {label}</span>
            ) : (
              <>Expires {label}</>
            )}
          </p>
        </div>
        <button
          type="button"
          onClick={remove}
          disabled={busy}
          aria-label={`Remove ${cardBrandLabel(card.brand)} ending ${card.last4}`}
          className="inline-flex shrink-0 items-center gap-2 rounded-full border border-ink/10 px-4 py-2 text-sm font-medium transition-colors hover:border-error hover:text-error disabled:opacity-50"
        >
          {busy ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Trash2 className="h-4 w-4" />
          )}
          Remove
        </button>
      </div>
      {error && <p className="mt-2 text-xs text-error">{error}</p>}
    </li>
  );
}
