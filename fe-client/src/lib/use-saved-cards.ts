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
import { useApi } from "@/lib/api";
import { afterFailedRead } from "@/lib/failed-read";
import { reportError } from "@/lib/report-error";
import { cardsAfterRemoval, type CardsRead, type SavedCard } from "@/lib/saved-cards";

export function useSavedCards() {
  const api = useApi();
  const [read, setRead] = useState<CardsRead>({ status: "loading" });
  // Only the newest read may settle the state: a slow older one landing after a
  // Try again, or after a removal, would draw a list the member has moved past.
  const latest = useRef(0);

  const load = useCallback(
    async (showLoading: boolean) => {
      const mine = ++latest.current;
      if (showLoading) setRead({ status: "loading" });
      try {
        const res = await api.get<{ cards: SavedCard[] }>("/me/cards");
        if (latest.current === mine) setRead({ status: "loaded", cards: res.cards ?? [] });
      } catch (err) {
        reportError(err, { scope: "saved-cards" });
        if (latest.current !== mine) return;
        // A refusal the app answers elsewhere (sign-in, a paused studio, maintenance)
        // keeps the section loading; any other failure is drawn as one.
        setRead(afterFailedRead(err, { optional: true }).loading ? { status: "loading" } : { status: "failed" });
      }
    },
    [api],
  );

  useEffect(() => {
    void load(true);
    return () => {
      latest.current++;
    };
  }, [load]);

  /** Read again, in place of a failed read: what Try again runs. */
  const retry = useCallback(() => load(true), [load]);

  /**
   * Detach one card, then drop it from the list at once. The list is then read
   * again quietly, and if that read fails the member still sees the card gone.
   * Throws when the removal itself failed, leaving the list untouched.
   */
  const remove = useCallback(
    async (cardId: string) => {
      await api.del(`/me/cards/${encodeURIComponent(cardId)}`);
      setRead((current) => cardsAfterRemoval(current, cardId));
      const mine = ++latest.current;
      try {
        const res = await api.get<{ cards: SavedCard[] }>("/me/cards");
        if (latest.current === mine) setRead({ status: "loaded", cards: res.cards ?? [] });
      } catch (err) {
        reportError(err, { scope: "saved-cards" });
      }
    },
    [api],
  );

  return { read, retry, remove };
}
