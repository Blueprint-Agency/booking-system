"use client";

import { z } from "zod";
import { toast } from "sonner";
import { useAdminState } from "@/lib/admin-state";
import { adjustPackage, extendPackageExpiry } from "@/lib/mutations/packages";
import { Input, Textarea, Select } from "@/components/ui";
import { FormDialog } from "@/components/form/form-dialog";
import { FormField } from "@/components/form";
import type { ClientPackage } from "@/types";

const schema = z
  .object({
    mode: z.enum(["adjust", "extend"]),
    delta: z.coerce.number().int().optional(),
    newExpiryDate: z.string().optional(),
    note: z.string().min(1, "Audit note required"),
  })
  .superRefine((v, ctx) => {
    if (v.mode === "adjust") {
      if (v.delta === undefined || v.delta === 0) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["delta"], message: "Non-zero delta required" });
      }
    } else if (v.mode === "extend") {
      if (!v.newExpiryDate) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["newExpiryDate"], message: "Pick a date" });
      }
    }
  });

type FormValues = z.infer<typeof schema>;

export function PackageAdjustDialog({
  pkg,
  open,
  onOpenChange,
}: {
  pkg: ClientPackage;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const product = useAdminState((s) => s.products.find((p) => p.id === pkg.productId));
  const productLabel = product?.name ?? pkg.productId;

  const onSubmit = (v: FormValues) => {
    if (v.mode === "adjust" && v.delta !== undefined && v.delta !== 0) {
      adjustPackage({ packageId: pkg.id, delta: v.delta, note: v.note });
      toast.success(`Package adjusted by ${v.delta > 0 ? "+" : ""}${v.delta}`);
    } else if (v.mode === "extend" && v.newExpiryDate) {
      const iso = new Date(`${v.newExpiryDate}T23:59:59`).toISOString();
      extendPackageExpiry({ packageId: pkg.id, newExpiryIso: iso, note: v.note });
      toast.success("Expiry updated");
    }
  };

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Adjust: ${productLabel}`}
      description={`${pkg.sessionsRemaining}/${pkg.sessionsTotal} remaining${
        pkg.expiresAt ? ` · expires ${new Date(pkg.expiresAt).toLocaleDateString()}` : ""
      }`}
      schema={schema}
      defaultValues={{
        mode: "adjust",
        delta: 0,
        newExpiryDate: pkg.expiresAt ? pkg.expiresAt.slice(0, 10) : "",
        note: "",
      }}
      onSubmit={onSubmit}
      submitLabel="Apply"
    >
      {(form) => {
        const mode = form.watch("mode");
        return (
          <>
            <FormField name="mode" label="Action" required>
              <Select id="mode" {...form.register("mode")}>
                <option value="adjust">Adjust sessions</option>
                <option value="extend">Extend expiry</option>
              </Select>
            </FormField>
            {mode === "adjust" && (
              <FormField
                name="delta"
                label="Change"
                required
                hint="Positive adds sessions, negative subtracts"
              >
                <Input id="delta" type="number" {...form.register("delta")} />
              </FormField>
            )}
            {mode === "extend" && (
              <FormField name="newExpiryDate" label="New expiry date" required>
                <Input id="newExpiryDate" type="date" {...form.register("newExpiryDate")} />
              </FormField>
            )}
            <FormField name="note" label="Audit note" required>
              <Textarea id="note" rows={3} {...form.register("note")} />
            </FormField>
            <p className="text-xs text-muted">
              Logged as{" "}
              <span className="font-mono">{mode === "adjust" ? "credit.adjust" : "package.extend"}</span> on{" "}
              {new Date().toLocaleString()}.
            </p>
          </>
        );
      }}
    </FormDialog>
  );
}
