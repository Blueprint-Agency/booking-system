"use client";

/**
 * Add or edit one set of Billing details (#399), in the app's bottom sheet.
 *
 * One form for both, and for every place a member meets it: their account's
 * Billing details page today, and checkout's picker (#401), which adds or edits
 * a set without leaving the purchase. On save it hands back the set as the
 * backend stored it, so the caller can select it.
 *
 * The fields are checked by the backend, which answers a refusal with one
 * sentence (a field missing or too long, a fourth set); the sheet shows that
 * sentence as it is, so the rules live in one place.
 */
import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Portal } from "@/components/ui/portal";
import { Select } from "@/components/ui/select";
import {
  BTN_PRIMARY,
  BTN_SECONDARY,
  SHEET_ACTIONS,
  SHEET_BACKDROP,
  SHEET_HANDLE,
  SHEET_PANEL,
  SHEET_TEXT,
  SHEET_TITLE,
} from "@/components/ui/styles";
import { useApi } from "@/lib/api";
import {
  addBillingDetails,
  billingDetailsError,
  countryOptions,
  editBillingDetails,
  emptyFields,
  fieldsOf,
  type BillingDetails,
  type BillingDetailsFields,
} from "@/lib/billing-details";
import { reportError } from "@/lib/report-error";
import { useBodyScrollLock } from "@/lib/use-body-scroll-lock";
import { useFocusTrap } from "@/lib/use-focus-trap";

const inputClass =
  "min-h-[44px] rounded-xl border border-ink/10 bg-card px-4 py-2.5 text-sm w-full focus:border-accent focus:ring-2 focus:ring-accent/15 focus:outline-none transition-shadow disabled:opacity-60";
const labelClass = "text-sm font-semibold text-ink mb-1.5 block";

export function BillingDetailsSheet({
  editing,
  defaultName = "",
  onSaved,
  onClose,
}: {
  /** The set to edit; absent to add one. */
  editing?: BillingDetails;
  /** The name a new set starts with — the member's own, on their first. */
  defaultName?: string;
  onSaved: (set: BillingDetails) => void | Promise<void>;
  onClose: () => void;
}) {
  const api = useApi();
  const [fields, setFields] = useState<BillingDetailsFields>(() =>
    editing ? fieldsOf(editing) : emptyFields(defaultName),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const trapRef = useFocusTrap<HTMLDivElement>(true);
  useBodyScrollLock(true);

  const set = (key: keyof BillingDetailsFields) => (value: string) =>
    setFields((current) => ({ ...current, [key]: value }));

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      const saved = editing
        ? await editBillingDetails(api, editing.id, fields)
        : await addBillingDetails(api, fields);
      await onSaved(saved);
    } catch (err) {
      reportError(err, { scope: editing ? "edit-billing-details" : "add-billing-details" });
      setError(billingDetailsError(err, "Couldn't save your billing details. Please try again."));
      setSaving(false);
    }
  }

  const text = (
    key: Exclude<keyof BillingDetailsFields, "country">,
    label: string,
    options: { optional?: boolean; autoComplete?: string; maxLength: number },
  ) => (
    <div>
      <label htmlFor={`billing-${key}`} className={labelClass}>
        {label}
        {options.optional && <span className="ml-1 font-normal text-muted">(optional)</span>}
      </label>
      <input
        id={`billing-${key}`}
        type="text"
        value={fields[key]}
        onChange={(e) => set(key)(e.target.value)}
        required={!options.optional}
        maxLength={options.maxLength}
        autoComplete={options.autoComplete}
        disabled={saving}
        className={inputClass}
      />
    </div>
  );

  return (
    <Portal>
      <div className={SHEET_BACKDROP} onClick={() => !saving && onClose()}>
        <div
          ref={trapRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="billing-details-title"
          tabIndex={-1}
          className={SHEET_PANEL}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.key === "Escape" && !saving && onClose()}
        >
          <span aria-hidden className={SHEET_HANDLE} />
          <h3 id="billing-details-title" className={SHEET_TITLE}>
            {editing ? "Edit billing details" : "Add billing details"}
          </h3>
          <p className={SHEET_TEXT}>
            The name and address your receipts are made out to. Bill yourself, or
            your company.
          </p>

          <form onSubmit={save} className="mt-5 space-y-4">
            {text("name", "Name", { autoComplete: "name", maxLength: 200 })}
            {text("line1", "Address line 1", { autoComplete: "address-line1", maxLength: 200 })}
            {text("line2", "Address line 2", { optional: true, autoComplete: "address-line2", maxLength: 200 })}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {text("city", "City", { autoComplete: "address-level2", maxLength: 100 })}
              {text("state", "State", { optional: true, autoComplete: "address-level1", maxLength: 100 })}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {text("postcode", "Postcode", { autoComplete: "postal-code", maxLength: 20 })}
              <div>
                <label htmlFor="billing-country" className={labelClass}>
                  Country
                </label>
                <Select
                  id="billing-country"
                  value={fields.country}
                  onChange={set("country")}
                  options={countryOptions()}
                  disabled={saving}
                  triggerClassName="px-4 focus:ring-2 focus:ring-accent/15"
                />
              </div>
            </div>

            {error && (
              <p role="alert" className="text-sm text-error">
                {error}
              </p>
            )}

            <div className={SHEET_ACTIONS}>
              <button type="button" onClick={onClose} disabled={saving} className={BTN_SECONDARY}>
                Cancel
              </button>
              <button type="submit" disabled={saving} className={BTN_PRIMARY}>
                {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                {saving ? "Saving…" : "Save"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </Portal>
  );
}
