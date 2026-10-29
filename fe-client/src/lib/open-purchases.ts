"use client";

/**
 * Unfinished purchases — a balance the member left outstanding.
 *
 * A purchase paid with two cards sits open between the two, and it **does not
 * expire** — it closes when paid in full, or when the studio refunds it.
 * The member can come back to it from their account page whenever
 * they like, and the backend mints a fresh checkout session for whatever is
 * still owed at that moment.
 *
 * Every figure here is the server's. The amount the member types is the one
 * thing that travels the other way, and the backend checks it against the
 * balance it reads for itself — nothing on this page is trusted with what may
 * be charged.
 */
import { useCallback, useEffect, useState } from "react";
import { useApi, type Api } from "@/lib/api";
import { reportError } from "@/lib/report-error";

export interface OpenPurchase {
  id: string;
  kind: string;
  item_name: string;
  total_sgd: string;
  paid_sgd: string;
  outstanding_sgd: string;
  /** The balance is below the card minimum, so it can only be cleared in one go. */
  must_pay_in_full: boolean;
  part_paid_at: string | null;
  created_at: string;
}

/**
 * Whether this studio offers Part Payment at all, and the smallest instalment.
 * `couldntCheck` is a third answer, apart from on and off: the read failed, so
 * the app does not know. `enabled` is never true then.
 */
export interface PartPaymentOptions {
  enabled: boolean;
  floorSgd: string;
  couldntCheck: boolean;
  /** Read the options again — what Try again runs. */
  retry: () => void;
}

export function useOpenPurchases() {
  const api = useApi();
  const [purchases, setPurchases] = useState<OpenPurchase[]>([]);
  const [loading, setLoading] = useState(true);
  // **An empty list and a failed read are not the same thing.** Both leave
  // `purchases` empty, and a caller that cannot tell them apart will read a
  // network error as "you owe nothing" — which is the single most misleading
  // sentence this feature could print at somebody who has just paid half.
  const [failed, setFailed] = useState(false);

  const refetch = useCallback(async () => {
    try {
      const res = await api.get<{ purchases: OpenPurchase[] }>("/me/purchases/open");
      setPurchases(res.purchases ?? []);
      setFailed(false);
    } catch (err) {
      // A list that fails to load must not blank the account page around it.
      reportError(err, { scope: "open-purchases" });
      setPurchases([]);
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  return { purchases, loading, failed, refetch };
}

/**
 * What this studio offers at checkout. Off is the answer for a studio that has
 * not turned Part Payment on. A failed call is not that answer: Part Payment is
 * an optional way to pay a Balance that can always be paid whole, so the page
 * keeps the whole payment and says it could not check (`couldntCheck`) — never
 * offering Part Payment on a failed read, and never silently hiding it, which
 * would tell a member who meant to split the payment that the studio does not
 * allow it. The backend still decides what may be charged.
 */
export function usePartPaymentOptions(): PartPaymentOptions & { loading: boolean } {
  const api = useApi();
  const [state, setState] = useState<{
    enabled: boolean;
    floorSgd: string;
    couldntCheck: boolean;
    loading: boolean;
  }>({ enabled: false, floorSgd: "1.00", couldntCheck: false, loading: true });
  // Bumped by Try again: a new read, in place of the failed one. The line
  // stays up until it answers, so the page does not jump under the tap.
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt(n => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.get<{
          part_payment: { enabled: boolean; floor_sgd: string };
        }>("/me/checkout/options");
        if (!cancelled) {
          setState({
            enabled: Boolean(res.part_payment?.enabled),
            floorSgd: res.part_payment?.floor_sgd ?? "1.00",
            couldntCheck: false,
            loading: false,
          });
        }
      } catch (err) {
        reportError(err, { scope: "checkout-options" });
        if (!cancelled) setState(s => ({ ...s, enabled: false, couldntCheck: true, loading: false }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [api, attempt]);

  return { ...state, retry };
}

/**
 * Send the member back to Stripe for more of one purchase.
 *
 * `amountSgd` is null to clear the whole remaining balance, which is what the
 * Resume button does unless the member says otherwise. The session created here
 * expires the previous one first, so two open sessions can never together take
 * more than the price.
 */
export async function resumePurchase(
  api: Api,
  purchaseId: string,
  amountSgd: number | null,
): Promise<void> {
  const res = await api.post<{ url: string | null }>(`/me/purchases/${purchaseId}/resume`, {
    ...(amountSgd == null ? {} : { part_payment_sgd: amountSgd }),
  });
  if (!res.url) throw new Error("no checkout url");
  window.location.href = res.url;
}
