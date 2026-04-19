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
import { RecurrenceEditor } from "./recurrence-editor";
import {
  createSessionTemplate,
  updateSessionTemplate,
} from "@/lib/mutations/sessions";
import type { SessionTemplate } from "@/types";

const schema = z.object({
  name: z.string().min(1, "Name required"),
  category: z.string().min(1, "Category required"),
  level: z.enum(["beginner", "intermediate", "advanced", "all"]),
  duration: z.coerce.number().int().positive("Must be positive"),
  defaultPriceCents: z.coerce.number().int().min(0),
  defaultInstructorId: z.string().min(1, "Pick an instructor"),
  locationIds: z.array(z.string()).min(1, "Pick at least one location"),
  packageEligible: z.boolean(),
  description: z.string(),
  time: z.string().regex(/^\d{2}:\d{2}$/, "HH:MM"),
});

type FormValues = z.infer<typeof schema>;

export interface ClassTemplateFormProps {
  template?: SessionTemplate;
}

export function ClassTemplateForm({ template }: ClassTemplateFormProps) {
  const router = useRouter();
  const tenantId = useCurrentTenantId();
  const instructors = useWithTenant(useAdminState((s) => s.instructors));
  const locations = useWithTenant(useAdminState((s) => s.locations));
  const [recurrence, setRecurrence] = useState<string>(template?.recurrence ?? "");

  const defaults: FormValues = {
    name: template?.name ?? "",
    category: template?.category ?? "",
    level: template?.level ?? "all",
    duration: template?.duration ?? 60,
    defaultPriceCents: template?.defaultPriceCents ?? 3500,
    defaultInstructorId: template?.defaultInstructorId ?? instructors[0]?.id ?? "",
    locationIds: template?.locationIds ?? (locations[0] ? [locations[0].id] : []),
    packageEligible: template?.packageEligible ?? true,
    description: template?.description ?? "",
    time: template?.time ?? "07:00",
  };

  const onSubmit = (v: FormValues) => {
    if (!tenantId) {
      toast.error("No tenant selected");
      return;
    }
    if (!recurrence) {
      toast.error("Pick at least one day for recurrence");
      return;
    }
    if (template) {
      updateSessionTemplate({
        id: template.id,
        ...v,
        recurrence,
      });
      toast.success("Template updated");
    } else {
      createSessionTemplate({
        tenantId,
        ...v,
        recurrence,
      });
      toast.success("Template created");
    }
    router.push("/admin/classes");
  };

  return (
    <Form schema={schema} defaultValues={defaults} onSubmit={onSubmit}>
      {(form) => (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="space-y-4">
              <FormField name="name" label="Class name" required>
                <Input id="name" {...form.register("name")} placeholder="Morning Hatha" />
              </FormField>
              <FormField name="category" label="Category" required hint="e.g., Hatha, Vinyasa, Yin">
                <Input id="category" {...form.register("category")} />
              </FormField>
              <div className="grid grid-cols-2 gap-4">
                <FormField name="level" label="Level" required>
                  <Select id="level" {...form.register("level")}>
                    <option value="all">All levels</option>
                    <option value="beginner">Beginner</option>
                    <option value="intermediate">Intermediate</option>
                    <option value="advanced">Advanced</option>
                  </Select>
                </FormField>
                <FormField name="duration" label="Duration (min)" required>
                  <Input id="duration" type="number" min={15} step={15} {...form.register("duration")} />
                </FormField>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <FormField name="time" label="Start time" required>
                  <Input id="time" type="time" {...form.register("time")} />
                </FormField>
                <FormField name="defaultPriceCents" label="Default price (Â¢)" required hint="3500 = SGD 35.00">
                  <Input id="defaultPriceCents" type="number" min={0} {...form.register("defaultPriceCents")} />
                </FormField>
              </div>
              <FormField name="defaultInstructorId" label="Default instructor" required>
                <Select id="defaultInstructorId" {...form.register("defaultInstructorId")}>
                  {instructors.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.name}
                    </option>
                  ))}
                </Select>
              </FormField>

              <FormField name="locationIds" label="Locations" required>
                <div className="space-y-1.5">
                  {locations.map((loc) => {
                    const checked = form.watch("locationIds")?.includes(loc.id) ?? false;
                    return (
                      <label key={loc.id} className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) => {
                            const cur = form.getValues("locationIds") ?? [];
                            if (e.target.checked) {
                              form.setValue("locationIds", [...cur, loc.id], { shouldValidate: true });
                            } else {
                              form.setValue(
                                "locationIds",
                                cur.filter((x: string) => x !== loc.id),
                                { shouldValidate: true },
                              );
                            }
                          }}
                          className="h-4 w-4 rounded border-border accent-accent"
                        />
                        <span className="text-ink">{loc.name}</span>
                        <span className="text-xs text-muted">{loc.area}</span>
                      </label>
                    );
                  })}
                </div>
              </FormField>

              <FormField name="packageEligible" label="">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    {...form.register("packageEligible")}
                    className="h-4 w-4 rounded border-border accent-accent"
                  />
                  <span className="text-ink">Package credits eligible</span>
                </label>
              </FormField>

              <FormField name="description" label="Description">
                <Textarea id="description" rows={3} {...form.register("description")} />
              </FormField>
            </div>

            <div className="space-y-4">
              <div>
                <Label>Recurrence</Label>
                <p className="mb-3 mt-1 text-xs text-muted">
                  V1 is weekly only. Day chips + end condition.
                </p>
                <RecurrenceEditor value={recurrence} onChange={setRecurrence} />
              </div>
            </div>
          </div>

          <div className="mt-8 flex items-center justify-end gap-2 border-t border-border pt-4">
            <Button type="button" variant="ghost" onClick={() => router.push("/admin/classes")}>
              Cancel
            </Button>
            <Button type="submit" disabled={form.formState.isSubmitting}>
              {template ? "Save changes" : "Create template"}
            </Button>
          </div>
        </>
      )}
    </Form>
  );
}
