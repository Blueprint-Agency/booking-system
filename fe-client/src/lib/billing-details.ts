"use client";

/**
 * A member's Billing details (#399): up to three name-and-address sets a
 * Purchase is billed to, one of them the default. The rules — how many, which
 * is the default, what each field may hold — are the backend's
 * (`/me/billing-details`); this reads and writes them, and says them.
 *
 * Kept free of any one page so checkout can pick from the same sets and add or
 * edit one without leaving (#401).
 */
import { useCallback, useEffect, useState } from "react";
import { ApiError, useApi, type Api } from "@/lib/api";
import { reportError } from "@/lib/report-error";

/** The most sets a member may keep; the backend refuses a fourth. */
export const BILLING_DETAILS_LIMIT = 3;

/** The country a set is in until the member picks another. */
export const DEFAULT_COUNTRY = "SG";

export interface BillingDetails {
  id: string;
  name: string;
  line1: string;
  line2: string | null;
  city: string;
  state: string | null;
  postcode: string;
  /** ISO 3166-1 alpha-2. */
  country: string;
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

/** What the form edits: every field as text, blanks meaning "none". */
export interface BillingDetailsFields {
  name: string;
  line1: string;
  line2: string;
  city: string;
  state: string;
  postcode: string;
  country: string;
}

export const emptyFields = (name = ""): BillingDetailsFields => ({
  name,
  line1: "",
  line2: "",
  city: "",
  state: "",
  postcode: "",
  country: DEFAULT_COUNTRY,
});

export const fieldsOf = (set: BillingDetails): BillingDetailsFields => ({
  name: set.name,
  line1: set.line1,
  line2: set.line2 ?? "",
  city: set.city,
  state: set.state ?? "",
  postcode: set.postcode,
  country: set.country,
});

/** The body the backend takes: optional lines sent blank are cleared there. */
const bodyOf = (fields: BillingDetailsFields) => ({
  name: fields.name,
  line1: fields.line1,
  line2: fields.line2.trim() ? fields.line2 : null,
  city: fields.city,
  state: fields.state.trim() ? fields.state : null,
  postcode: fields.postcode,
  country: fields.country,
});

const regionNames = (() => {
  try {
    return new Intl.DisplayNames(["en"], { type: "region", fallback: "none" });
  } catch {
    return null;
  }
})();

/** A country's English name from its code, or the code when the browser cannot say. */
export function countryName(code: string): string {
  return regionNames?.of(code) ?? code;
}

/** The codes ISO 3166 leaves to private use: never a country. */
const PRIVATE_USE = /^(AA|Q[M-Z]|X[A-Z]|ZZ)$/;

let countries: { value: string; label: string }[] | null = null;

/** Every country the browser can name, by name — the same set the backend accepts. */
export function countryOptions(): { value: string; label: string }[] {
  if (countries) return countries;
  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const found: { value: string; label: string }[] = [];
  for (const a of letters) {
    for (const b of letters) {
      const code = a + b;
      if (PRIVATE_USE.test(code)) continue;
      const name = regionNames?.of(code);
      if (name) found.push({ value: code, label: name });
    }
  }
  // A browser with no region names still offers the default.
  if (found.length === 0) found.push({ value: DEFAULT_COUNTRY, label: "Singapore" });
  countries = found.sort((x, y) => x.label.localeCompare(y.label));
  return countries;
}

/** The address one component per line, the country by name: how a set reads back to the member. */
export function addressLines(set: BillingDetails): string[] {
  return [
    set.line1,
    set.line2,
    [set.city, set.state, set.postcode].filter(Boolean).join(" "),
    countryName(set.country),
  ].filter((line): line is string => Boolean(line && line.trim()));
}

/**
 * What to tell the member when a save is refused: the backend's own sentence
 * when it gave one (a field too long, the limit reached), else a general one.
 */
export function billingDetailsError(err: unknown, fallback: string): string {
  if (err instanceof ApiError && err.body && typeof err.body === "object" && "message" in err.body) {
    const message = (err.body as { message: unknown }).message;
    if (typeof message === "string" && message.trim()) return message;
  }
  return fallback;
}

export async function addBillingDetails(api: Api, fields: BillingDetailsFields): Promise<BillingDetails> {
  const res = await api.post<{ billing_details: BillingDetails }>("/me/billing-details", bodyOf(fields));
  return res.billing_details;
}

export async function editBillingDetails(
  api: Api,
  id: string,
  fields: BillingDetailsFields,
): Promise<BillingDetails> {
  const res = await api.patch<{ billing_details: BillingDetails }>(
    `/me/billing-details/${encodeURIComponent(id)}`,
    bodyOf(fields),
  );
  return res.billing_details;
}

export async function deleteBillingDetails(api: Api, id: string): Promise<void> {
  await api.del(`/me/billing-details/${encodeURIComponent(id)}`);
}

export async function makeDefaultBillingDetails(api: Api, id: string): Promise<BillingDetails> {
  const res = await api.post<{ billing_details: BillingDetails }>(
    `/me/billing-details/${encodeURIComponent(id)}/default`,
  );
  return res.billing_details;
}

/** The member's sets, read from the server, oldest first. */
export function useBillingDetails() {
  const api = useApi();
  const [sets, setSets] = useState<BillingDetails[]>([]);
  const [loading, setLoading] = useState(true);
  // An empty list and a failed read both leave `sets` empty; telling a member
  // they have none because a request failed invites a duplicate.
  const [failed, setFailed] = useState(false);

  const refetch = useCallback(async () => {
    try {
      const res = await api.get<{ billing_details: BillingDetails[] }>("/me/billing-details");
      setSets(res.billing_details ?? []);
      setFailed(false);
    } catch (err) {
      reportError(err, { scope: "billing-details" });
      setSets([]);
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  return { sets, loading, failed, refetch };
}
