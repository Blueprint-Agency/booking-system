/**
 * A member's Receipts (#384), as `GET /me/receipts` and `GET /me/receipts/:id`
 * send them, and how they read.
 *
 * Free of React and of the API client: what a Receipt *says* is the part worth
 * testing on its own. Everything on a Receipt is what the studio wrote when it
 * was issued; nothing here works a figure out.
 */
import { cardBrandLabel } from "./saved-cards.ts";

export type ReceiptStatus = "issued" | "refunded";

/** One row of the Receipts list. */
export interface ReceiptSummary {
  id: string;
  /** `R-000123`, as issued. */
  number: string;
  /** What it was for, in one phrase. */
  item: string;
  issued_at: string;
  total_sgd: string;
  status: ReceiptStatus;
}

export interface ReceiptLine {
  description: string;
  quantity: number;
  list_price_sgd: string;
  discount_sgd: string;
  discounts: { source: string; label: string; amount_sgd: string }[];
  amount_sgd: string;
}

export interface ReceiptPayment {
  method: string | null;
  card_brand: string | null;
  card_last4: string | null;
  wallet: string | null;
  amount_sgd?: string;
  paid_at?: string;
}

/** One Receipt, whole. */
export interface Receipt {
  id: string;
  number: string;
  kind: string;
  issued_at: string;
  status: ReceiptStatus;
  refunded_at: string | null;
  seller: {
    name: string;
    legal_name: string | null;
    registration_number: string | null;
    address: string | null;
    footer: string | null;
  };
  buyer: { name: string | null; email: string | null };
  lines: ReceiptLine[];
  subtotal_sgd: string;
  discount_sgd: string;
  total_sgd: string;
  payments: Required<ReceiptPayment>[];
  /**
   * The Receipt drawn as a page of its own, by the backend: the one design the
   * PDF, the email and the studio portal share. The Receipt page frames it.
   */
  html: string;
}

export interface ReceiptsPage {
  receipts: ReceiptSummary[];
  total: number;
  page: number;
  page_size: number;
}

/**
 * Money as the studio prints it to members: `S$150.00`, always to the cent —
 * the backend's `sgdText`, which the confirmation emails use too.
 */
export function receiptAmount(sgd: string): string {
  return `S$${(Math.round(Number(sgd) * 100) / 100).toFixed(2)}`;
}

const WALLETS: Record<string, string> = {
  apple_pay: "Apple Pay",
  google_pay: "Google Pay",
  samsung_pay: "Samsung Pay",
  link: "Link",
};

const METHODS: Record<string, string> = {
  paynow: "PayNow",
  grabpay: "GrabPay",
  alipay: "Alipay",
  wechat_pay: "WeChat Pay",
  link: "Link",
};

/** How a payment was made: `Visa •••• 4242`, `Apple Pay · Visa •••• 4242`, `PayNow`. */
export function paymentLabel(p: Pick<ReceiptPayment, "method" | "card_brand" | "card_last4" | "wallet">): string {
  if (p.method === "card" || p.card_brand) {
    const card = [p.card_brand ? cardBrandLabel(p.card_brand) : "Card", p.card_last4 ? `•••• ${p.card_last4}` : null]
      .filter(Boolean)
      .join(" ");
    const wallet = p.wallet ? (WALLETS[p.wallet] ?? p.wallet) : null;
    return wallet ? `${wallet} · ${card}` : card;
  }
  if (p.method) return METHODS[p.method] ?? p.method.charAt(0).toUpperCase() + p.method.slice(1).replace(/_/g, " ");
  return "Online payment";
}

export function receiptStatusLabel(status: ReceiptStatus): string {
  return status === "refunded" ? "Refunded" : "Issued";
}

/** `R-000123.pdf`: what a downloaded Receipt is saved as, the name the backend gives it too. */
export function receiptPdfFilename(number: string): string {
  return `${number.replace(/[^A-Za-z0-9._-]/g, "_")}.pdf`;
}

/** What the Receipts page asks for: the days picked, if any, and the page. */
export function receiptsQuery(input: { from: string; to: string; page: number }): Record<string, string | number> {
  const query: Record<string, string | number> = {};
  if (input.from) query.from = input.from;
  if (input.to) query.to = input.to;
  query.page = input.page;
  return query;
}

/** Why a date range cannot be asked for, or null when it can. */
export function dateRangeProblem(from: string, to: string): string | null {
  return from && to && to < from ? "The end date is before the start date." : null;
}
