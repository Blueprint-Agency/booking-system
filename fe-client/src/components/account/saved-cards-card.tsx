"use client";
/**
 * The member's saved cards, on their profile beside the password: account
 * admin, not something waiting on the member.
 *
 * There is no "add a card" here. A card is kept while paying, and this section
 * only lists the cards kept and removes them.
 *
 * Remove asks in the row itself, not in a browser dialog. A failed read says it
 * could not load and offers Try again; it never draws an empty list, because
 * "no saved cards" told to someone with a card on file invites them to save it
 * again.
 */
import { useEffect, useRef, useState } from "react";
import { AlertCircle, CreditCard, Loader2 } from "lucide-react";
import { BTN_CANCEL, BTN_SECONDARY } from "@/components/ui/styles";
import { cn } from "@/lib/utils";
import { reportError } from "@/lib/report-error";
import { cardBrandLabel, cardExpiry, cardsView, removeCardMessage, type SavedCard } from "@/lib/saved-cards";
import { useSavedCards } from "@/lib/use-saved-cards";

const cardClass = "rounded-2xl bg-card border border-ink/5 shadow-soft p-5 sm:p-6";

export function SavedCardsCard() {
  const { read, retry, remove } = useSavedCards();
  const view = cardsView(read);

  return (
    <section className={cardClass} aria-labelledby="saved-cards-heading" aria-busy={view === "loading"}>
      <h2 id="saved-cards-heading" className="text-base font-bold text-ink">
        Saved cards
      </h2>
      <p className="mt-0.5 text-sm text-muted">
        Cards you chose to keep while paying. Our payment provider stores them, so we only ever see the last four
        digits, and they work only at this studio.
      </p>

      <div className="mt-5">
        {view === "loading" ? (
          <p role="status" className="text-sm text-muted">
            Loading your cards…
          </p>
        ) : view === "failed" ? (
          <div className="flex flex-col items-start gap-3 rounded-xl border border-ink/10 bg-warm px-4 py-3 text-sm text-ink sm:flex-row sm:items-center">
            <span className="flex items-start gap-2">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-muted" aria-hidden />
              <span>Couldn&apos;t load your saved cards. Nothing has changed.</span>
            </span>
            <button type="button" onClick={() => void retry()} className={cn(BTN_SECONDARY, "min-h-[44px] sm:ml-auto")}>
              Try again
            </button>
          </div>
        ) : view === "empty" ? (
          <p className="text-sm text-muted">You don&apos;t have any saved cards.</p>
        ) : (
          read.status === "loaded" && (
            <ul className="space-y-3">
              {read.cards.map((card) => (
                <SavedCardRow key={card.id} card={card} onRemove={remove} />
              ))}
            </ul>
          )
        )}
      </div>
    </section>
  );
}

function SavedCardRow({ card, onRemove }: { card: SavedCard; onRemove: (cardId: string) => Promise<void> }) {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const keepRef = useRef<HTMLButtonElement>(null);
  const removeRef = useRef<HTMLButtonElement>(null);
  const { label, expired } = cardExpiry(card);
  const name = `${cardBrandLabel(card.brand)} ending ${card.last4}`;

  // Opening the question moves focus onto the safe answer, and closing it
  // returns focus to the Remove it came from.
  const wasAsking = useRef(false);
  useEffect(() => {
    if (asking) keepRef.current?.focus();
    else if (wasAsking.current) removeRef.current?.focus();
    wasAsking.current = asking;
  }, [asking]);

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      await onRemove(card.id);
    } catch (err) {
      reportError(err, { scope: "remove-saved-card" });
      setError(removeCardMessage(card));
      setAsking(false);
    } finally {
      // Cleared on both paths: the row normally unmounts on success, but a list
      // that still holds the card must not be left with a disabled button.
      setBusy(false);
    }
  }

  return (
    <li className="rounded-xl border border-ink/10 px-3 py-3 sm:px-4">
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-ink/[0.04] text-muted">
          <CreditCard className="h-5 w-5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-ink">
            {cardBrandLabel(card.brand)} ···· {card.last4}
          </p>
          <p className="mt-0.5 text-xs text-muted">
            {expired ? <span className="text-error">Expired {label}</span> : <>Expires {label}</>}
          </p>
        </div>
        {!asking && (
          <button
            ref={removeRef}
            type="button"
            onClick={() => {
              setError(null);
              setAsking(true);
            }}
            aria-label={`Remove ${name}`}
            className={cn(BTN_CANCEL, "min-h-[44px] shrink-0")}
          >
            Remove
          </button>
        )}
      </div>

      {asking && (
        <div role="group" aria-label={`Remove ${name}?`} className="mt-3 border-t border-ink/5 pt-3">
          <p className="text-sm text-ink">
            Remove this card? It won&apos;t be offered again, and you can still pay with another.
          </p>
          <div className="mt-3 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button
              ref={keepRef}
              type="button"
              disabled={busy}
              onClick={() => setAsking(false)}
              className={cn(BTN_SECONDARY, "min-h-[44px]")}
            >
              Keep card
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void confirm()}
              aria-label={`Confirm removing ${name}`}
              className={cn(BTN_CANCEL, "min-h-[44px]")}
            >
              {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
              {busy ? "Removing…" : "Remove card"}
            </button>
          </div>
        </div>
      )}

      {error && (
        <p role="alert" className="mt-2 text-xs text-error">
          {error}
        </p>
      )}
    </li>
  );
}
