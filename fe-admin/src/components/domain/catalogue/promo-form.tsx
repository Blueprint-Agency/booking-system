"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { z } from "zod";
import { toast } from "sonner";
import { useAdminState } from "@/lib/admin-state";
import { useCurrentTenantId } from "@/lib/admin-auth";
import { useWithTenant } from "@/lib/tenant-scope";
import { Form, FormField } from "@/components/form";
import { Button, Input, Select, Label } from "@/components/ui";
import { createPromo, updatePromo } from "@/lib/mutations/promos";
import type { Promo } from "@/types";

const schema = z.object({
  code: z.string().min(1, "Code required").regex(/^[A-Z0-9_-]+$/i, "Letters, numbers, _ -"),
  discountType: z.enum(["amount", "percent"]),
  discountValue: z.coerce.number().int().min(1),
  startsAt: z.string().min(1, "Required"),
  endsAt: z.string().min(1, "Required"),
  usageCap: z.coerce.number().int().min(1),
  perUserCap: z.coerce.number().int().min(1),
  active: z.boolean(),
});

type FormValues = z.infer<typeof schema>;

export interface PromoFormProps {
  promo?: Promo;
}

function toLocal(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const off = d.getTimezoneOffset() * 60_000;
  return new Date(d.getTime() - off).toISOString().slice(0, 16);
}

export function PromoForm({ promo }: PromoFormProps) {
  const router = useRouter();
  const tenantId = useCurrentTenantId();
  const products = useWithTenant(useAdminState((s) => s.products));
  const [productIds, setProductIds] = useState<string[]>(promo?.productIds ?? []);

  const defaults: FormValues = {
    code: promo?.code ?? "",
    discountType: promo?.discountType ?? "amount",
    discountValue: promo?.discountValue ?? 0,
    startsAt: toLocal(promo?.startsAt ?? new Date().toISOString()),
    endsAt: toLocal(
      promo?.endsAt ??
        new Date(Date.now() + 30 * 24 * 3600_000).toISOString(),
    ),
    usageCap: promo?.usageCap ?? 100,
    perUserCap: promo?.perUserCap ?? 1,
    active: promo?.active ?? true,
  };

  const onSubmit = (v: FormValues) => {
    if (!tenantId) {
      toast.error("No tenant");
      return;
    }
    try {
      if (promo) {
        updatePromo({
          id: promo.id,
          ...v,
          startsAt: new Date(v.startsAt).toISOString(),
          endsAt: new Date(v.endsAt).toISOString(),
          productIds,
        });
        toast.success("Promo updated");
      } else {
        createPromo({
          tenantId,
          ...v,
          startsAt: new Date(v.startsAt).toISOString(),
          endsAt: new Date(v.endsAt).toISOString(),
          productIds,
        });
        toast.success("Promo created");
      }
      router.push("/admin/promos");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    }
  };

  return (
    <Form schema={schema} defaultValues={defaults} onSubmit={onSubmit}>
      {(form) => (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="space-y-4">
              <FormField name="code" label="Code" required hint="Stored uppercase. Letters, numbers, _ -">
                <Input
                  id="code"
                  {...form.register("code")}
                  placeholder="DIWALI30"
                  className="uppercase"
                />
              </FormField>
              <div className="grid grid-cols-2 gap-4">
                <FormField name="discountType" label="Discount type" required>
                  <Select id="discountType" {...form.register("discountType")}>
                    <option value="amount">Amount (cents)</option>
                    <option value="percent">Percent</option>
                  </Select>
                </FormField>
                <FormField name="discountValue" label="Value" required>
                  <Input id="discountValue" type="number" min={1} {...form.register("discountValue")} />
                </FormField>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <FormField name="startsAt" label="Starts at" required>
                  <Input id="startsAt" type="datetime-local" {...form.register("startsAt")} />
                </FormField>
                <FormField name="endsAt" label="Ends at" required>
                  <Input id="endsAt" type="datetime-local" {...form.register("endsAt")} />
                </FormField>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <FormField name="usageCap" label="Usage cap" required>
                  <Input id="usageCap" type="number" min={1} {...form.register("usageCap")} />
                </FormField>
                <FormField name="perUserCap" label="Per-user cap" required>
                  <Input id="perUserCap" type="number" min={1} {...form.register("perUserCap")} />
                </FormField>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  {...form.register("active")}
                  className="h-4 w-4 rounded border-border accent-accent"
                />
                <span className="text-ink">Active</span>
              </label>
            </div>

            <div className="space-y-4">
              <div>
                <Label>Restrict to products</Label>
                <p className="mb-2 mt-1 text-xs text-muted">
                  Leave empty to allow all products.
                </p>
                <div className="space-y-1.5">
                  {products.map((p) => {
                    const checked = productIds.includes(p.id);
                    return (
                      <label key={p.id} className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) => {
                            setProductIds((prev) =>
                              e.target.checked
                                ? [...prev, p.id]
                                : prev.filter((x) => x !== p.id),
                            );
                          }}
                          className="h-4 w-4 rounded border-border accent-accent"
                        />
                        <span className="text-ink">{p.name}</span>
                        <span className="ml-auto text-xs text-muted">{p.type}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>

          <div className="mt-8 flex items-center justify-end gap-2 border-t border-border pt-4">
            <Button type="button" variant="ghost" onClick={() => router.push("/admin/promos")}>
              Cancel
            </Button>
            <Button type="submit" disabled={form.formState.isSubmitting}>
              {promo ? "Save changes" : "Create promo"}
            </Button>
          </div>
        </>
      )}
    </Form>
  );
}
