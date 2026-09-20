"use client";

/**
 * Reading and removing the member's saved cards (#185).
 *
 * Read from the server every time rather than cached: a card expires, an issuer
 * replaces it, or the member removes it on another device, and a stale list is
 * a list that offers a card which will decline. The server in turn reads it
 * from the payment provider, for the same reason.
 *
 * What a card *says* is `saved-cards.ts` next door, which has no React in it so
 * those rules can be tested on their own.
 */
import { useCallback, useEffect, useState } from "react";
import { useApi, type Api } from "@/lib/api";
import { reportError } from "@/lib/report-error";
import type { SavedCard } from "@/lib/saved-cards";

export function useSavedCards() {
  const api = useApi();
  const [cards, setCards] = useState<SavedCard[]>([]);
  const [loading, setLoading] = useState(true);
  // An empty list and a failed read both leave `cards` empty, and telling a
  // member "no saved cards" because a request errored invites them to save a
  // second copy of a card they already have. Same rule as `useOpenPurchases`.
  const [failed, setFailed] = useState(false);

  const refetch = useCallback(async () => {
    try {
      const res = await api.get<{ cards: SavedCard[] }>("/me/cards");
      setCards(res.cards ?? []);
      setFailed(false);
    } catch (err) {
      reportError(err, { scope: "saved-cards" });
      setCards([]);
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  return { cards, loading, failed, refetch };
}

/** Forget one. The server checks it is this member's before detaching it. */
export async function removeSavedCard(api: Api, cardId: string): Promise<void> {
  await api.del(`/me/cards/${encodeURIComponent(cardId)}`);
}
