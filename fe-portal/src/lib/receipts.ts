/**
 * The studio's Receipts (#389), as `GET /portal/admin/receipts` and
 * `GET /portal/admin/receipts/:id` send them, and how the admin pages read
 * them.
 *
 * Free of React and of the API client. Everything on a Receipt is what the
 * studio wrote when it was issued; nothing here works a figure out. The wording
 * is the member's Receipt's, so the admin and the member read one Receipt the
 * same way on a call.
 */
import { ERROR_CODES } from "./error-codes";

export type ReceiptStatus = "issued" | "refunded";

export const RECEIPT_KINDS = [
  "class_package",
  "pt_package",
  "workshop",
  "merch",
  "cross_location_add_on",
  "corporate_package",
] as const;
export type ReceiptKind = (typeof RECEIPT_KINDS)[number];

/** One row of the studio's Receipts list. */
export interface ReceiptListRow {
  id: string;
  /** `R-000123`, as issued. */
  number: string;
  /** What it was for, in one phrase. */
  item: string;
  kind: ReceiptKind;
  issued_at: string;
  total_sgd: string;
  status: ReceiptStatus;
  /** Null once the member was permanently deleted. */
  client_id: string | null;
  /** The buyer the Receipt names; emptied by a permanent deletion. */
  buyer_name: string | null;
  buyer_email: string | null;
}

export interface ReceiptsPage {
  receipts: ReceiptListRow[];
  total: number;
  page: number;
  page_size: number;
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
  amount_sgd: string;
  paid_at: string;
}

/** One Receipt, whole: exactly what the member's own page shows. */
export interface Receipt {
  id: string;
  number: string;
  kind: ReceiptKind;
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
  payments: ReceiptPayment[];
  /**
   * The Receipt drawn as a page of its own, by the backend: the one design the
   * PDF, the email and the member's Receipt page share. The Receipt page frames it.
   */
  html: string;
}

/** Money as the Receipt prints it: `S$150.00`, always to the cent. */
export function receiptAmount(sgd: string): string {
  return `S$${(Math.round(Number(sgd) * 100) / 100).toFixed(2)}`;
}

const CARD_BRANDS: Record<string, string> = {
  visa: "Visa",
  mastercard: "Mastercard",
  amex: "American Express",
  unionpay: "UnionPay",
  jcb: "JCB",
  discover: "Discover",
  diners: "Diners Club",
};

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

const capitalised = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, " ");

/** How a payment was made: `Visa •••• 4242`, `Apple Pay · Visa •••• 4242`, `PayNow`. */
export function paymentLabel(p: Pick<ReceiptPayment, "method" | "card_brand" | "card_last4" | "wallet">): string {
  if (p.method === "card" || p.card_brand) {
    const card = [
      p.card_brand ? (CARD_BRANDS[p.card_brand] ?? capitalised(p.card_brand)) : "Card",
      p.card_last4 ? `•••• ${p.card_last4}` : null,
    ]
      .filter(Boolean)
      .join(" ");
    const wallet = p.wallet ? (WALLETS[p.wallet] ?? p.wallet) : null;
    return wallet ? `${wallet} · ${card}` : card;
  }
  if (p.method) return METHODS[p.method] ?? capitalised(p.method);
  return "Online payment";
}

const KIND_LABELS: Record<ReceiptKind, string> = {
  class_package: "Class package",
  pt_package: "Private sessions",
  workshop: "Workshop",
  merch: "Merch",
  cross_location_add_on: "Cross-Location Add-On",
  corporate_package: "Corporate package",
};

/** What kind of sale a Receipt is for, as the kind filter names it. */
export function receiptKindLabel(kind: ReceiptKind): string {
  return KIND_LABELS[kind];
}

export function receiptStatusLabel(status: ReceiptStatus): string {
  return status === "refunded" ? "Refunded" : "Issued";
}

/** The list's position: the search, the days, the kind and status filters, and the page. */
export interface ReceiptsState {
  q: string;
  /** `YYYY-MM-DD` studio days, or empty for no bound. */
  from: string;
  to: string;
  kind: ReceiptKind | "all";
  status: ReceiptStatus | "all";
  page: number;
  pageSize: number;
}

const PAGE_SIZES = [25, 50, 75, 100];
const DEFAULT_PAGE_SIZE = 25;
const PLAIN_DATE = /^\d{4}-\d{2}-\d{2}$/;

const isKind = (v: string | null): v is ReceiptKind => (RECEIPT_KINDS as readonly string[]).includes(v ?? "");

/** What the list asks the backend for: only what is set. */
export function receiptsQuery(s: ReceiptsState): Record<string, string | number> {
  const query: Record<string, string | number> = {};
  const q = s.q.trim();
  if (q) query.q = q;
  if (s.from) query.from = s.from;
  if (s.to) query.to = s.to;
  if (s.kind !== "all") query.kind = s.kind;
  if (s.status !== "all") query.status = s.status;
  query.page = s.page;
  query.page_size = s.pageSize;
  return query;
}

/**
 * Where Export CSV downloads the list from (#390): the search and filters the
 * list is showing, and no page, so the file is every page of it.
 */
export function receiptsExportPath(s: ReceiptsState): string {
  const filters = Object.entries(receiptsQuery(s)).filter(([k]) => k !== "page" && k !== "page_size");
  const qs = new URLSearchParams(filters.map(([k, v]) => [k, String(v)])).toString();
  return `/portal/admin/receipts/export.csv${qs ? `?${qs}` : ""}`;
}

/** Why a resend was refused (#390), from the refusal's body. */
export function resendRefusal(body: unknown): string {
  const code = (body as { error?: unknown } | null)?.error;
  if (code === ERROR_CODES.receipt_member_deleted) {
    return "This member has been permanently deleted, so there is no one to send it to.";
  }
  if (code === ERROR_CODES.receipt_email_unavailable) {
    return "What this purchase granted is no longer there to put its email together. Download the PDF and send it another way.";
  }
  if (code === ERROR_CODES.receipt_not_found) return "There is no such receipt at this studio.";
  return "The receipt could not be sent. Try again in a moment.";
}

/** The position as the address bar keeps it, so Back from a Receipt lands on the same page. */
export function receiptsSearch(s: ReceiptsState): string {
  const p = new URLSearchParams();
  if (s.q) p.set("q", s.q);
  if (s.from) p.set("from", s.from);
  if (s.to) p.set("to", s.to);
  if (s.kind !== "all") p.set("kind", s.kind);
  if (s.status !== "all") p.set("status", s.status);
  if (s.page !== 1) p.set("page", String(s.page));
  if (s.pageSize !== DEFAULT_PAGE_SIZE) p.set("size", String(s.pageSize));
  const qs = p.toString();
  return qs ? `?${qs}` : "";
}

/** The position read back off the address bar; anything that is not one is the default. */
export function readReceiptsState(search: string): ReceiptsState {
  const p = new URLSearchParams(search);
  const kind = p.get("kind");
  const status = p.get("status");
  const from = p.get("from") ?? "";
  const to = p.get("to") ?? "";
  const page = Number(p.get("page"));
  const size = Number(p.get("size"));
  return {
    q: p.get("q") ?? "",
    from: PLAIN_DATE.test(from) ? from : "",
    to: PLAIN_DATE.test(to) ? to : "",
    kind: isKind(kind) ? kind : "all",
    status: status === "issued" || status === "refunded" ? status : "all",
    page: Number.isInteger(page) && page > 0 ? page : 1,
    pageSize: PAGE_SIZES.includes(size) ? size : DEFAULT_PAGE_SIZE,
  };
}
