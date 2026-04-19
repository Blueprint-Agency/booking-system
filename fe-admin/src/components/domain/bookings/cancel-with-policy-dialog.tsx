"use client";

import { useMemo } from "react";
import { z } from "zod";
import { toast } from "sonner";
import { AlertTriangle, ShieldCheck } from "lucide-react";
import { useAdminState } from "@/lib/admin-state";
import { cancelBookingAdmin } from "@/lib/mutations/bookings";
import { Textarea } from "@/components/ui";
import { FormDialog } from "@/components/form/form-dialog";
import { FormField } from "@/components/form";
import type { Booking, Session } from "@/types";

const schema = z.object({
  refund: z.enum(["refund", "forfeit"]),
  reason: z.string().min(1, "Reason required"),
});

type FormValues = z.infer<typeof schema>;

function hoursUntil(iso: string): number {
  return (new Date(iso).getTime() - Date.now()) / (1000 * 60 * 60);
}

export function CancelWithPolicyDialog({
  booking,
  session,
  open,
  onOpenChange,
}: {
  booking: Booking;
  session: Session;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const policy = useAdminState((s) => s.policy);
  const startIso = `${session.date}T${session.time}:00`;
  const hoursLeft = hoursUntil(startIso);
  const withinPolicy = hoursLeft >= policy.classCancelHours;

  const defaults = useMemo<FormValues>(
    () => ({
      refund: withinPolicy ? "refund" : ("" as unknown as "refund"),
      reason: "",
    }),
    [withinPolicy],
  );

  const onSubmit = (v: FormValues) => {
    cancelBookingAdmin({
      bookingId: booking.id,
      refund: v.refund === "refund",
      reason: v.reason,
    });
    toast.success(v.refund === "refund" ? "Cancelled and refunded" : "Cancelled, credit forfeited");
  };

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Cancel booking"
      description={`${session.name} · starts ${new Date(startIso).toLocaleString()}`}
      schema={schema}
      defaultValues={defaults}
      onSubmit={onSubmit}
      submitLabel="Cancel booking"
      submitVariant="danger"
    >
      {(form) => {
        const refund = form.watch("refund");
        return (
          <>
            <div
              className={
                withinPolicy
                  ? "rounded-md border border-sage/40 bg-sage/10 p-3 flex gap-2"
                  : "rounded-md border border-warning/40 bg-warning/10 p-3 flex gap-2"
              }
            >
              {withinPolicy ? (
                <ShieldCheck className="h-5 w-5 text-sage flex-shrink-0 mt-0.5" />
              ) : (
                <AlertTriangle className="h-5 w-5 text-warning flex-shrink-0 mt-0.5" />
              )}
              <div className="text-sm">
                <div className="font-medium text-ink">
                  {withinPolicy
                    ? `Within policy (${Math.floor(hoursLeft)}h to start, cutoff ${policy.classCancelHours}h)`
                    : `Outside policy (${Math.max(0, Math.floor(hoursLeft))}h to start, cutoff ${policy.classCancelHours}h)`}
                </div>
                <div className="text-muted">
                  {withinPolicy
                    ? "Default: refund the credit."
                    : "No default — choose refund or forfeit explicitly. You're overriding the cancellation window."}
                </div>
              </div>
            </div>

            <FormField name="refund" label="Credit handling" required>
              <div className="grid grid-cols-2 gap-2">
                <label
                  className={
                    refund === "refund"
                      ? "rounded-md border-2 border-accent bg-card p-3 cursor-pointer"
                      : "rounded-md border border-border bg-card p-3 cursor-pointer hover:border-ink/30"
                  }
                >
                  <input
                    type="radio"
                    value="refund"
                    {...form.register("refund")}
                    className="sr-only"
                  />
                  <div className="font-medium text-sm text-ink">Refund credit</div>
                  <div className="text-xs text-muted mt-0.5">Return session to package</div>
                </label>
                <label
                  className={
                    refund === "forfeit"
                      ? "rounded-md border-2 border-accent bg-card p-3 cursor-pointer"
                      : "rounded-md border border-border bg-card p-3 cursor-pointer hover:border-ink/30"
                  }
                >
                  <input
                    type="radio"
                    value="forfeit"
                    {...form.register("refund")}
                    className="sr-only"
                  />
                  <div className="font-medium text-sm text-ink">Forfeit credit</div>
                  <div className="text-xs text-muted mt-0.5">Credit consumed, no refund</div>
                </label>
              </div>
            </FormField>

            <FormField name="reason" label="Reason" required hint="Stored on the booking and audit-logged.">
              <Textarea id="reason" rows={3} {...form.register("reason")} />
            </FormField>

            <p className="text-xs text-muted">
              Logged as <span className="font-mono">booking.cancelAdmin</span> on {new Date().toLocaleString()}.
            </p>
          </>
        );
      }}
    </FormDialog>
  );
}
