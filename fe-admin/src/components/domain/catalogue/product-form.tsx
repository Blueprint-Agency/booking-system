"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { z } from "zod";
import { toast } from "sonner";
import { useAdminState } from "@/lib/admin-state";
import { useCurrentTenantId } from "@/lib/admin-auth";
import { useWithTenant } from "@/lib/tenant-scope";
import { Form, FormField } from "@/components/form";
import { Button, Input, Select, Textarea, Label } from "@/components/ui";
import { createProduct, updateProduct } from "@/lib/mutations/products";
import type { Product } from "@/types";

const schema = z.object({
  name: z.string().min(1, "Name required"),
  type: z.enum(["drop-in", "package", "membership", "vip", "bundle"]),
  creditType: z.enum(["class", "pt1on1", "pt2on1"]),
  priceCents: z.coerce.number().int().min(0),
  sessionCount: z.coerce.number().int().min(0).optional(),
  expiryDays: z.coerce.number().int().min(0).optional(),
  sessionsPerMonth: z.coerce.number().int().min(0).optional(),
  description: z.string(),
  active: z.boolean(),
  crossLocation: z.boolean(),
});

type FormValues = z.infer<typeof schema>;

export interface ProductFormProps {
  product?: Product;
}

export function ProductForm({ product }: ProductFormProps) {
  const router = useRouter();
  const tenantId = useCurrentTenantId();
  const instructors = useWithTenant(useAdminState((s) => s.instructors));
  const [pricesByInstructor, setPricesByInstructor] = useState<Record<string, number>>(
    product?.priceByInstructorId ?? {},
  );

  const defaults: FormValues = {
    name: product?.name ?? "",
    type: product?.type ?? "package",
    creditType: product?.creditType ?? "class",
    priceCents: product?.priceCents ?? 0,
    sessionCount: product?.sessionCount ?? undefined,
    expiryDays: product?.expiryDays ?? undefined,
    sessionsPerMonth: product?.sessionsPerMonth ?? undefined,
    description: product?.description ?? "",
    active: product?.active ?? true,
    crossLocation: product?.crossLocation ?? true,
  };

  const onSubmit = (v: FormValues) => {
    if (!tenantId) {
      toast.error("No tenant");
      return;
    }
    const usePerInstructor = v.creditType !== "class" && Object.keys(pricesByInstructor).length > 0;
    const priceByInstructorId = usePerInstructor ? pricesByInstructor : undefined;
    if (product) {
      updateProduct({
        id: product.id,
        ...v,
        sessionCount: v.sessionCount ?? null,
        expiryDays: v.expiryDays ?? null,
        sessionsPerMonth: v.sessionsPerMonth ?? null,
        priceByInstructorId,
      });
      toast.success("Product updated");
    } else {
      createProduct({
        tenantId,
        ...v,
        sessionCount: v.sessionCount ?? null,
        expiryDays: v.expiryDays ?? null,
        sessionsPerMonth: v.sessionsPerMonth ?? null,
        priceByInstructorId,
      });
      toast.success("Product created");
    }
    router.push("/admin/packages");
  };

  return (
    <Form schema={schema} defaultValues={defaults} onSubmit={onSubmit}>
      {(form) => {
        const creditType = form.watch("creditType");
        const showInstructorOverride = creditType !== "class";
        return (
          <>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="space-y-4">
                <FormField name="name" label="Name" required>
                  <Input id="name" {...form.register("name")} placeholder="10 Class Pack" />
                </FormField>
                <div className="grid grid-cols-2 gap-4">
                  <FormField name="type" label="Type" required>
                    <Select id="type" {...form.register("type")}>
                      <option value="drop-in">Drop-in</option>
                      <option value="package">Package</option>
                      <option value="membership">Membership</option>
                      <option value="vip">VIP</option>
                    </Select>
                  </FormField>
                  <FormField name="creditType" label="Credit type" required>
                    <Select id="creditType" {...form.register("creditType")}>
                      <option value="class">Class</option>
                      <option value="pt1on1">PT 1-on-1</option>
                      <option value="pt2on1">PT 2-on-1</option>
                    </Select>
                  </FormField>
                </div>
                <FormField name="priceCents" label="Price (cents)" required hint="3500 = SGD 35">
                  <Input id="priceCents" type="number" min={0} {...form.register("priceCents")} />
                </FormField>
                <div className="grid grid-cols-3 gap-4">
                  <FormField name="sessionCount" label="Sessions">
                    <Input id="sessionCount" type="number" min={0} {...form.register("sessionCount")} />
                  </FormField>
                  <FormField name="expiryDays" label="Expiry days">
                    <Input id="expiryDays" type="number" min={0} {...form.register("expiryDays")} />
                  </FormField>
                  <FormField name="sessionsPerMonth" label="Per month">
                    <Input id="sessionsPerMonth" type="number" min={0} {...form.register("sessionsPerMonth")} />
                  </FormField>
                </div>
                <FormField name="description" label="Description">
                  <Textarea id="description" rows={3} {...form.register("description")} />
                </FormField>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    {...form.register("active")}
                    className="h-4 w-4 rounded border-border accent-accent"
                  />
                  <span className="text-ink">Active</span>
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    {...form.register("crossLocation")}
                    className="h-4 w-4 rounded border-border accent-accent"
                  />
                  <span className="text-ink">Cross-location (credits redeemable at any studio location)</span>
                </label>
              </div>

              <div className="space-y-4">
                {showInstructorOverride && (
                  <div className="rounded-lg border border-border bg-card p-4">
                    <Label>Per-instructor pricing override</Label>
                    <p className="mb-3 mt-1 text-xs text-muted">
                      Leave blank to use the default price. Useful for senior instructors.
                    </p>
                    <div className="space-y-2">
                      {instructors.map((i) => (
                        <div key={i.id} className="flex items-center gap-2">
                          <span className="flex-1 text-sm text-ink">{i.name}</span>
                          <Input
                            type="number"
                            min={0}
                            placeholder="Default"
                            value={pricesByInstructor[i.id] ?? ""}
                            onChange={(e) => {
                              const v = e.target.value;
                              setPricesByInstructor((prev) => {
                                const next = { ...prev };
                                if (!v) delete next[i.id];
                                else next[i.id] = Number(v);
                                return next;
                              });
                            }}
                            className="w-32"
                          />
                          <span className="w-8 text-xs text-muted">Â¢</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="mt-8 flex items-center justify-end gap-2 border-t border-border pt-4">
              <Button type="button" variant="ghost" onClick={() => router.push("/admin/packages")}>
                Cancel
              </Button>
              <Button type="submit" disabled={form.formState.isSubmitting}>
                {product ? "Save changes" : "Create product"}
              </Button>
            </div>
          </>
        );
      }}
    </Form>
  );
}
