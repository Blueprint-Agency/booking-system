"use client";

/**
 * Reading and removing the member's saved cards.
 *
 * Read from the server on every visit and never cached: a card expires, an
 * issuer replaces it, or the member removes it on another device, and the
 * server in turn reads the list live from the payment provider for the same
 * reason. What a card says is `saved-cards.ts`.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, apiErrorCode, useApi } from "@/lib/api";
import { afterFailedRead } from "@/lib/failed-read";
import { reportError } from "@/lib/report-error";
import { cardsAfterRemoval, cardStillSaved, type CardsRead, type SavedCard } from "@/lib/saved-cards";

export function useSavedCards() {
  const api = useApi();
  const [read, setRead] = useState<CardsRead>({ status: "loading" });
  // Only the newest read may settle the state: a slow older one landing after a
  // Try again, or after a removal, would draw a list the member has moved past.
  const latest = useRef(0);

  /**
   * Read the list. A loud read shows Loading and draws a failure; a quiet one
   * leaves the list on screen as it was when it fails. Resolves to the cards
   * read, or `null` when the read failed.
   */
  const load = useCallback(
    async ({ quiet }: { quiet: boolean }): Promise<SavedCard[] | null> => {
      const mine = ++latest.current;
      if (!quiet) setRead({ status: "loading" });
      try {
        const res = await api.get<{ cards: SavedCard[] }>("/me/cards");
        const cards = res.cards ?? [];
        if (latest.current === mine) setRead({ status: "loaded", cards });
        return cards;
      } catch (err) {
        reportError(err, { scope: "saved-cards" });
        if (!quiet && latest.current === mine) {
          // A refusal the app answers elsewhere (sign-in, a paused studio, maintenance)
          // keeps the section loading; any other failure is drawn as one.
          setRead(afterFailedRead(err, { optional: true }).loading ? { status: "loading" } : { status: "failed" });
        }
        return null;
      }
    },
    [api],
  );

  useEffect(() => {
    void load({ quiet: false });
    return () => {
      latest.current++;
    };
  }, [load]);

  /** Read again, in place of a failed read: what Try again runs. */
  const retry = useCallback(() => load({ quiet: false }), [load]);

  /**
   * Detach one card. On success, or when the card is already gone (another
   * device removed it: `404 card_not_found`), it leaves the list at once and the
   * list is read again quietly to match the server. On any other failure the
   * list is read again quietly too, so the rows match the server, and the result
   * says whether that read shows the card still there (`null`: it could not say)
   * and carries the server's own sentence when it sent one.
   */
  const remove = useCallback(
    async (cardId: string): Promise<RemoveResult> => {
      try {
        await api.del(`/me/cards/${encodeURIComponent(cardId)}`);
      } catch (err) {
        const alreadyGone = err instanceof ApiError && err.status === 404 && apiErrorCode(err) === "card_not_found";
        if (!alreadyGone) {
          reportError(err, { scope: "remove-saved-card" });
          const stillSaved = cardStillSaved(await load({ quiet: true }), cardId);
          // The card is not there after all: the member's wish is met.
          if (stillSaved === false) return { ok: true };
          return { ok: false, stillSaved, reason: serverSentence(err) };
        }
      }
      setRead((current) => cardsAfterRemoval(current, cardId));
      void load({ quiet: true });
      return { ok: true };
    },
    [api, load],
  );

  return { read, retry, remove };
}

export type RemoveResult = { ok: true } | { ok: false; stillSaved: boolean | null; reason?: string };

/** The sentence a refusal (a 4xx) carries in its `message`, if it has one; a server fault never speaks to the member. */
function serverSentence(err: unknown): string | undefined {
  if (!(err instanceof ApiError) || err.status < 400 || err.status >= 500) return undefined;
  const message = (err.body as { message?: unknown } | null)?.message;
  return typeof message === "string" && message.trim() !== "" ? message : undefined;
}
