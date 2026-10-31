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
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { AlertCircle, CreditCard, Loader2 } from "lucide-react";
import { BTN_CANCEL, BTN_SECONDARY } from "@/components/ui/styles";
import { cn } from "@/lib/utils";
import { reportError } from "@/lib/report-error";
import { currentImpersonationGrant } from "@/lib/impersonation-handoff";
import {
  cardBrandLabel,
  cardExpiry,
  cardsView,
  removeCardMessage,
  removedCardAnnouncement,
  type SavedCard,
} from "@/lib/saved-cards";
import { useSavedCards, type RemoveResult } from "@/lib/use-saved-cards";

const cardClass = "rounded-2xl bg-card border border-ink/5 shadow-soft p-5 sm:p-6";

/** The grant cookie is set before the page loads and gone after it, so there is nothing to subscribe to. */
const noSubscription = () => () => {};

export function SavedCardsCard() {
  const { read, retry, remove } = useSavedCards();
  const view = cardsView(read);
  const rootRef = useRef<HTMLElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [announcement, setAnnouncement] = useState("");
  // Where focus goes once a removed card's row is gone: the next row's Remove,
  // or the heading when it was the last. Null when nothing is waiting.
  const focusAfterRemoval = useRef<{ removedId: string; nextId: string | null } | null>(null);

  // An admin impersonating the member sees the cards but cannot remove one:
  // the API refuses them, as keeping a card is only ever its owner's choice.
  const impersonating = useSyncExternalStore(
    noSubscription,
    () => currentImpersonationGrant() !== null,
    () => false,
  );

  async function removeCard(card: SavedCard): Promise<RemoveResult> {
    const cards = read.status === "loaded" ? read.cards : [];
    const at = cards.findIndex((c) => c.id === card.id);
    // Set before asking, because the list drops the card the moment the removal
    // is answered, before this function resumes; the effect below waits for
    // the card to be gone from the list.
    focusAfterRemoval.current = { removedId: card.id, nextId: cards[at + 1]?.id ?? null };
    const result = await remove(card.id);
    if (result.ok) setAnnouncement(removedCardAnnouncement(card));
    else focusAfterRemoval.current = null;
    return result;
  }

  useEffect(() => {
    const pending = focusAfterRemoval.current;
    if (!pending || read.status !== "loaded" || read.cards.some((c) => c.id === pending.removedId)) return;
    focusAfterRemoval.current = null;
    const next = pending.nextId
      ? Array.from(rootRef.current?.querySelectorAll<HTMLElement>("[data-remove-card]") ?? []).find(
          (el) => el.dataset.removeCard === pending.nextId,
        )
      : undefined;
    (next ?? headingRef.current)?.focus();
  }, [read]);

  return (
    <section ref={rootRef} className={cardClass} aria-labelledby="saved-cards-heading" aria-busy={view === "loading"}>
      <h2 ref={headingRef} tabIndex={-1} id="saved-cards-heading" className="text-base font-bold text-ink outline-none">
        Saved cards
      </h2>
      <p role="status" className="sr-only">
        {announcement}
      </p>
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
              <span>Couldn&apos;t load your saved cards.</span>
            </span>
            <button type="button" onClick={() => void retry()} className={cn(BTN_SECONDARY, "min-h-[44px] sm:ml-auto")}>
              Try again
            </button>
          </div>
        ) : view === "empty" ? (
          <p className="text-sm text-muted">You don&apos;t have any saved cards.</p>
        ) : (
          read.status === "loaded" && (
            <>
              {impersonating && <p className="mb-3 text-sm text-muted">Only the member can remove their saved cards.</p>}
              <ul className="space-y-3">
                {read.cards.map((card) => (
                  <SavedCardRow key={card.id} card={card} onRemove={removeCard} canRemove={!impersonating} />
                ))}
              </ul>
            </>
          )
        )}
      </div>
    </section>
  );
}

function SavedCardRow({
  card,
  onRemove,
  canRemove,
}: {
  card: SavedCard;
  onRemove: (card: SavedCard) => Promise<RemoveResult>;
  canRemove: boolean;
}) {
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
      const result = await onRemove(card);
      if (!result.ok) {
        setError(removeCardMessage(card, result));
        setAsking(false);
      }
    } catch (err) {
      // Not the server refusing: the removal never got an answer to read.
      reportError(err, { scope: "remove-saved-card" });
      setError(removeCardMessage(card, { stillSaved: null }));
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
        {canRemove && !asking && (
          <button
            ref={removeRef}
            data-remove-card={card.id}
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
