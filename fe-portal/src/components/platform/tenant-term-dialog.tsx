"use client";
import { useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button, Dialog, DialogFooter, Input, Label, Select } from "@/components/ui";
import { ApiError, type Api } from "@/lib/api";
import {
  TENANT_REFUSALS,
  TERM_MONTHS,
  addMonths,
  formatTermDate,
  setTenantTerm,
  type PlatformTenant,
  type TermMonths,
} from "@/lib/platform";

/**
 * Set a studio's Term: when it started, and how long it runs.
 *
 * The operator picks a start date and a duration; the end date is computed —
 * shown here as a preview, decided by the backend. On the end date the studio
 * is suspended automatically. Saving a new Term never reopens a studio whose
 * Term had already ended; that stays a separate, deliberate Reactivate.
 */
export interface TenantTermDialogProps {
  api: Api;
  tenant: PlatformTenant | null;
  onOpenChange: (open: boolean) => void;
  onSaved: (tenant: PlatformTenant) => void;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function TenantTermDialog({ api, tenant, onOpenChange, onSaved }: TenantTermDialogProps) {
  // The parent keys this component on the studio, so each opening starts from
  // that studio's own Term.
  const [startDate, setStartDate] = useState(tenant?.term.start_date ?? "");
  const [months, setMonths] = useState<TermMonths>(12);
  const [submitting, setSubmitting] = useState(false);

  const valid = ISO_DATE.test(startDate);
  const endDate = valid ? addMonths(startDate, months) : null;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!tenant || !valid) return;
    setSubmitting(true);
    try {
      const { tenant: updated } = await setTenantTerm(api, tenant.id, { start_date: startDate, months });
      const end = updated.term.end_date ? formatTermDate(updated.term.end_date) : "—";
      toast.success(
        updated.term.ended
          ? `${tenant.name}’s term ended on ${end}. It stays suspended.`
          : updated.status === "suspended"
            ? `${tenant.name}’s term now runs until ${end}. It is still suspended — reactivate it when ready.`
            : `${tenant.name}’s term now runs until ${end}.`,
      );
      onSaved(updated);
    } catch (err) {
      const code =
        err instanceof ApiError && err.body && typeof err.body === "object"
          ? (err.body as { error?: string }).error
          : undefined;
      toast.error(code && TENANT_REFUSALS[code] ? TENANT_REFUSALS[code] : "Could not save the term.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open={Boolean(tenant)}
      onOpenChange={onOpenChange}
      title="Term"
      description={tenant ? `How long ${tenant.name} is paid for. It is suspended automatically on the end date.` : ""}
    >
      <form className="flex flex-col gap-4" onSubmit={submit}>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="term-start">Start date</Label>
          <Input
            id="term-start"
            type="date"
            value={startDate}
            onChange={e => setStartDate(e.target.value)}
            required
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="term-months">Duration</Label>
          <Select
            id="term-months"
            value={String(months)}
            onChange={e => setMonths(Number(e.target.value) as TermMonths)}
          >
            {TERM_MONTHS.map(m => (
              <option key={m} value={String(m)}>
                {m} months
              </option>
            ))}
          </Select>
          <p className="text-xs text-muted">
            {endDate
              ? `Ends ${formatTermDate(endDate)} — the studio is suspended from that day, on its own time zone.`
              : "Pick a start date."}
          </p>
        </div>

        <DialogFooter>
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" disabled={!valid || submitting}>
            {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
            Save term
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
