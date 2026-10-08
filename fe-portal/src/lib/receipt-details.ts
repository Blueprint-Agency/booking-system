import type { Api } from "./api";

/**
 * A studio's receipt details (#391): the prefix its Receipt numbers carry and
 * the business details its Receipts print. Saving them reaches only Receipts
 * issued afterwards; the backend copies them onto each one as it is issued.
 */
export interface ReceiptDetails {
  prefix: string;
  legal_name: string | null;
  registration_number: string | null;
  address: string | null;
  footer: string | null;
}

/** `GET` / `PUT /portal/admin/settings/receipt-details`. */
export interface ReceiptDetailsView {
  receipt_details: ReceiptDetails;
  /** `R-000124`: the number the studio's next Receipt takes under the saved prefix. */
  next_number: string;
  /** `124`: the sequence alone, for previewing a prefix not yet saved. */
  next_sequence: number;
}

/** The form's fields, every one a string as an input holds it. */
export type ReceiptDetailsDraft = { [K in keyof ReceiptDetails]: string };

/** What every studio's Receipts are numbered under until it sets its own. */
export const DEFAULT_RECEIPT_PREFIX = "R";

/** The most each free-text detail may hold, as the backend counts it. */
export const RECEIPT_DETAIL_LIMITS = {
  legal_name: 200,
  registration_number: 50,
  address: 500,
  footer: 1000,
} as const;

/** The backend's rule: up to ten letters or digits, hyphens only between them. */
const PREFIX = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,8}[A-Za-z0-9])?$/;

const prefixOf = (raw: string) => raw.trim() || DEFAULT_RECEIPT_PREFIX;

/** `NW-000124`: the number a Receipt would take under `prefix`, as it prints it. */
export const receiptNumberPreview = (prefix: string, sequence: number): string =>
  `${prefixOf(prefix)}-${String(sequence).padStart(6, "0")}`;

/** Why `prefix` cannot be saved, or null when it can. A blank one is the default. */
export function receiptPrefixProblem(prefix: string): string | null {
  return PREFIX.test(prefixOf(prefix))
    ? null
    : "Up to 10 letters or digits, with hyphens only between them.";
}

export const emptyReceiptDetailsDraft = (): ReceiptDetailsDraft => ({
  prefix: DEFAULT_RECEIPT_PREFIX,
  legal_name: "",
  registration_number: "",
  address: "",
  footer: "",
});

/** Saved details, as the form shows them. */
export const receiptDetailsDraft = (details: ReceiptDetails): ReceiptDetailsDraft => ({
  prefix: details.prefix,
  legal_name: details.legal_name ?? "",
  registration_number: details.registration_number ?? "",
  address: details.address ?? "",
  footer: details.footer ?? "",
});

const orNull = (value: string) => value.trim() || null;

/** What the form sends: trimmed, a blank detail as none, a blank prefix as the default. */
export const receiptDetailsPayload = (draft: ReceiptDetailsDraft): ReceiptDetails => ({
  prefix: prefixOf(draft.prefix),
  legal_name: orNull(draft.legal_name),
  registration_number: orNull(draft.registration_number),
  address: orNull(draft.address),
  footer: orNull(draft.footer),
});

/**
 * Whether the operator filled in anything beyond the default, so the create
 * form sends receipt details only when there are some to send.
 */
export function hasReceiptDetails(draft: ReceiptDetailsDraft): boolean {
  const payload = receiptDetailsPayload(draft);
  return (
    payload.prefix !== DEFAULT_RECEIPT_PREFIX ||
    [payload.legal_name, payload.registration_number, payload.address, payload.footer].some(Boolean)
  );
}

const PATH = "/portal/admin/settings/receipt-details";

export const getReceiptDetails = (api: Api) => api.get<ReceiptDetailsView>(PATH);

export const saveReceiptDetails = (api: Api, details: ReceiptDetails) =>
  api.put<ReceiptDetailsView>(PATH, details);
