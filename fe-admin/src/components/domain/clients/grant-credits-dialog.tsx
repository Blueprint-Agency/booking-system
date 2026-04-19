"use client";

import { useMemo } from "react";
import { z } from "zod";
import { toast } from "sonner";
import { useAdminState } from "@/lib/admin-state";
import { grantCredits } from "@/lib/mutations/packages";
import { Input, Textarea, Select } from "@/components/ui";
import { FormDialog } from "@/components/form/form-dialog";
import { FormField } from "@/components/form";

const schema = z.object({
  productId: z.string().min(1, "Select a product"),
  sessions: z.coerce.number().int().positive("Must be positive"),
  expiresInDays: z.coerce.number().int().min(0).optional(),
  note: z.string().min(1, "Audit note required"),
});

type FormValues = z.infer<typeof schema>;

export function GrantCreditsDialog({
  clientId,
  open,
  onOpenChange,
}: {
  clientId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const products = useAdminState((s) =>
    s.products.filter((p) => p.active && (p.type === "package" || p.type === "drop-in")),
  );

  const defaults = useMemo<FormValues>(
    () => ({
      productId: products[0]?.id ?? "",
      sessions: products[0]?.sessionCount ?? 1,
      expiresInDays: products[0]?.expiryDays ?? 90,
      note: "",
    }),
    [products],
  );

  const onSubmit = (v: FormValues) => {
    const expiresAt =
      v.expiresInDays && v.expiresInDays > 0
        ? new Date(Date.now() + v.expiresInDays * 24 * 60 * 60 * 1000).toISOString()
        : null;
    grantCredits({
      clientId,
      productId: v.productId,
      sessions: v.sessions,
      expiresAt,
      note: v.note,
    });
    toast.success(`Granted ${v.sessions} credits`);
  };

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Grant credits"
      description="This action will be audit-logged."
      schema={schema}
      defaultValues={defaults}
      onSubmit={onSubmit}
      submitLabel="Grant"
    >
      {(form) => (
        <>
          <FormField name="productId" label="Product" required>
            <Select id="productId" {...form.register("productId")}>
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} · {p.creditType}
                </option>
              ))}
            </Select>
          </FormField>
          <div className="grid grid-cols-2 gap-4">
            <FormField name="sessions" label="Sessions" required>
              <Input id="sessions" type="number" min={1} {...form.register("sessions")} />
            </FormField>
            <FormField name="expiresInDays" label="Expires in (days)" hint="0 = no expiry">
              <Input id="expiresInDays" type="number" min={0} {...form.register("expiresInDays")} />
            </FormField>
          </div>
          <FormField name="note" label="Audit note" required hint="Why are you granting these credits?">
            <Textarea id="note" rows={3} {...form.register("note")} />
          </FormField>
          <p className="text-xs text-muted">
            Logged as <span className="font-mono">credit.grant</span> on {new Date().toLocaleString()}.
          </p>
        </>
      )}
    </FormDialog>
  );
}
