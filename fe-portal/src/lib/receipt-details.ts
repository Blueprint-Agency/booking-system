import type { Api } from "./api";

/**
 * A studio's Business details (#391, #398): the Business name it trades under,
 * the prefix its Receipt numbers carry and the details its Receipts print.
 * Saving them reaches only Receipts issued afterwards; the backend copies them
 * onto each one as it is issued.
 */
export interface ReceiptDetails {
  /**
   * Always set on a saved studio. Null only in what the super portal's create
   * form sends, where none means "the Domain name".
   */
  business_name: string | null;
  prefix: string;
  registration_number: string | null;
  address: string | null;
  footer: string | null;
}

/**
 * `GET` / `PUT /portal/admin/settings/business-details`, and the super
 * portal's `/platform/tenants/:id/business-details`, which answer alike.
 */
export interface ReceiptDetailsView {
  business_details: ReceiptDetails;
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
  business_name: 200,
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

/** Why `name` cannot be a studio's Business name, or null when it can. */
export function businessNameProblem(name: string): string | null {
  if (!name.trim()) return "A business name is required.";
  return name.trim().length > RECEIPT_DETAIL_LIMITS.business_name
    ? `At most ${RECEIPT_DETAIL_LIMITS.business_name} characters.`
    : null;
}

export const emptyReceiptDetailsDraft = (): ReceiptDetailsDraft => ({
  business_name: "",
  prefix: DEFAULT_RECEIPT_PREFIX,
  registration_number: "",
  address: "",
  footer: "",
});

/** Saved details, as the form shows them. */
export const receiptDetailsDraft = (details: ReceiptDetails): ReceiptDetailsDraft => ({
  business_name: details.business_name ?? "",
  prefix: details.prefix,
  registration_number: details.registration_number ?? "",
  address: details.address ?? "",
  footer: details.footer ?? "",
});

const orNull = (value: string) => value.trim() || null;

/**
 * What the form sends: trimmed, a blank detail as none, a blank prefix as the
 * default. A blank Business name is the create form's "use the Domain name";
 * the Business details page never sends one.
 */
export const receiptDetailsPayload = (draft: ReceiptDetailsDraft): ReceiptDetails => ({
  business_name: orNull(draft.business_name),
  prefix: prefixOf(draft.prefix),
  registration_number: orNull(draft.registration_number),
  address: orNull(draft.address),
  footer: orNull(draft.footer),
});

/**
 * Whether the operator filled in anything beyond the default, so the create
 * form sends Business details only when there are some to send.
 */
export function hasReceiptDetails(draft: ReceiptDetailsDraft): boolean {
  const payload = receiptDetailsPayload(draft);
  return (
    payload.prefix !== DEFAULT_RECEIPT_PREFIX ||
    [payload.business_name, payload.registration_number, payload.address, payload.footer].some(Boolean)
  );
}

const PATH = "/portal/admin/settings/business-details";

export const getReceiptDetails = (api: Api) => api.get<ReceiptDetailsView>(PATH);

export const saveReceiptDetails = (api: Api, details: ReceiptDetails) =>
  api.put<ReceiptDetailsView>(PATH, details);

/** The same details for any studio, as the super portal reads and saves them. */
const platformPath = (tenantId: string) => `/platform/tenants/${tenantId}/business-details`;

export const getStudioReceiptDetails = (api: Api, tenantId: string) =>
  api.get<ReceiptDetailsView>(platformPath(tenantId));

export const saveStudioReceiptDetails = (api: Api, tenantId: string, details: ReceiptDetails) =>
  api.put<ReceiptDetailsView>(platformPath(tenantId), details);
