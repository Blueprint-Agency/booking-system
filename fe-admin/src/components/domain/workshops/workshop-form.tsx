"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { z } from "zod";
import { toast } from "sonner";
import { Upload, Star } from "lucide-react";
import { useAdminState } from "@/lib/admin-state";
import { useCurrentTenantId } from "@/lib/admin-auth";
import { useWithTenant } from "@/lib/tenant-scope";
import { Form, FormField } from "@/components/form";
import { Button, Input, Select, Textarea, Label } from "@/components/ui";
import { WorkshopTierEditor } from "./workshop-tier-editor";
import { createWorkshop, updateWorkshop, newTier } from "@/lib/mutations/workshops";
import type { Session, WorkshopTier } from "@/types";

const schema = z.object({
  name: z.string().min(1, "Title required"),
  description: z.string().min(1, "Description required"),
  level: z.enum(["beginner", "intermediate", "advanced", "all"]),
  date: z.string().min(1, "Date required"),
  time: z.string().regex(/^\d{2}:\d{2}$/, "HH:MM"),
  duration: z.coerce.number().int().positive(),
  capacity: z.coerce.number().int().positive(),
  locationId: z.string(),
  instructorId: z.string().min(1, "Pick instructor"),
  featured: z.boolean(),
  published: z.boolean(),
});

type FormValues = z.infer<typeof schema>;

export interface WorkshopFormProps {
  workshop?: Session;
}

export function WorkshopForm({ workshop }: WorkshopFormProps) {
  const router = useRouter();
  const tenantId = useCurrentTenantId();
  const instructors = useWithTenant(useAdminState((s) => s.instructors));
  const locations = useWithTenant(useAdminState((s) => s.locations));
  const [tiers, setTiers] = useState<WorkshopTier[]>(
    workshop?.workshopTiers ?? [
      { ...newTier(), label: "Early Bird" },
      { ...newTier(), label: "Standard" },
    ],
  );
  const [heroImage, setHeroImage] = useState<string>(workshop?.workshopHeroImage ?? "");

  const defaults: FormValues = {
    name: workshop?.name ?? "",
    description: workshop?.description ?? "",
    level: workshop?.level ?? "all",
    date: workshop?.date ?? "",
    time: workshop?.time ?? "10:00",
    duration: workshop?.duration ?? 120,
    capacity: workshop?.capacity ?? 20,
    locationId: workshop?.locationId ?? locations[0]?.id ?? "",
    instructorId: workshop?.instructorId ?? instructors[0]?.id ?? "",
    featured: workshop?.workshopFeatured ?? false,
    published: workshop?.workshopPublished ?? false,
  };

  const onFile = (file: File | null) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result === "string") setHeroImage(result);
    };
    reader.readAsDataURL(file);
  };

  const onSubmit = (v: FormValues) => {
    if (!tenantId) {
      toast.error("No tenant selected");
      return;
    }
    if (tiers.length === 0) {
      toast.error("Add at least one tier");
      return;
    }
    if (workshop) {
      updateWorkshop({
        id: workshop.id,
        ...v,
        locationId: v.locationId || null,
        heroImage,
        tiers,
      });
      toast.success("Workshop updated");
    } else {
      createWorkshop({
        tenantId,
        ...v,
        locationId: v.locationId || null,
        heroImage,
        tiers,
      });
      toast.success("Workshop created");
    }
    router.push("/admin/workshops");
  };

  return (
    <Form schema={schema} defaultValues={defaults} onSubmit={onSubmit}>
      {(form) => (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="space-y-4 lg:col-span-2">
              <FormField name="name" label="Workshop title" required>
                <Input id="name" {...form.register("name")} placeholder="Weekend Yin Intensive" />
              </FormField>
              <FormField
                name="description"
                label="Description"
                required
                hint="Plain text for v1; rich editor lands in Phase F."
              >
                <Textarea id="description" rows={5} {...form.register("description")} />
              </FormField>

              <div className="grid grid-cols-2 gap-4">
                <FormField name="date" label="Date" required>
                  <Input id="date" type="date" {...form.register("date")} />
                </FormField>
                <FormField name="time" label="Start time" required>
                  <Input id="time" type="time" {...form.register("time")} />
                </FormField>
                <FormField name="duration" label="Duration (min)" required>
                  <Input id="duration" type="number" min={15} step={15} {...form.register("duration")} />
                </FormField>
                <FormField name="capacity" label="Capacity" required>
                  <Input id="capacity" type="number" min={1} {...form.register("capacity")} />
                </FormField>
                <FormField name="level" label="Level" required>
                  <Select id="level" {...form.register("level")}>
                    <option value="all">All levels</option>
                    <option value="beginner">Beginner</option>
                    <option value="intermediate">Intermediate</option>
                    <option value="advanced">Advanced</option>
                  </Select>
                </FormField>
                <FormField name="locationId" label="Location">
                  <Select id="locationId" {...form.register("locationId")}>
                    <option value="">No specific location</option>
                    {locations.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name}
                      </option>
                    ))}
                  </Select>
                </FormField>
              </div>
              <FormField name="instructorId" label="Instructor" required>
                <Select id="instructorId" {...form.register("instructorId")}>
                  {instructors.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.name}
                    </option>
                  ))}
                </Select>
              </FormField>

              <div>
                <Label>Pricing tiers</Label>
                <p className="mb-2 mt-1 text-xs text-muted">
                  Add as many tiers as you need (Early Bird, Standard, Duo, etc.).
                </p>
                <WorkshopTierEditor tiers={tiers} onChange={setTiers} />
              </div>
            </div>

            <div className="space-y-4">
              <div className="rounded-lg border border-border bg-card p-4">
                <Label>Hero image</Label>
                <p className="mb-3 mt-1 text-xs text-muted">
                  Used on the workshop card and detail page.
                </p>
                {heroImage ? (
                  <div className="relative overflow-hidden rounded-md border border-border">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={heroImage} alt="Hero preview" className="h-40 w-full object-cover" />
                  </div>
                ) : (
                  <label className="flex h-40 cursor-pointer flex-col items-center justify-center gap-2 rounded-md border border-dashed border-border bg-paper/40 text-xs text-muted hover:bg-paper">
                    <Upload className="h-5 w-5" />
                    <span>Click to upload</span>
                    <input
                      type="file"
                      accept="image/*"
                      onChange={(e) => onFile(e.target.files?.[0] ?? null)}
                      className="sr-only"
                    />
                  </label>
                )}
                {heroImage && (
                  <div className="mt-2 flex items-center justify-between text-xs">
                    <label className="cursor-pointer text-accent hover:underline">
                      Replace
                      <input
                        type="file"
                        accept="image/*"
                        onChange={(e) => onFile(e.target.files?.[0] ?? null)}
                        className="sr-only"
                      />
                    </label>
                    <button
                      type="button"
                      onClick={() => setHeroImage("")}
                      className="text-muted hover:text-error"
                    >
                      Remove
                    </button>
                  </div>
                )}
              </div>

              <div className="rounded-lg border border-border bg-card p-4 space-y-2">
                <Label>Visibility</Label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    {...form.register("published")}
                    className="h-4 w-4 rounded border-border accent-accent"
                  />
                  <span className="text-ink">Published</span>
                  <span className="ml-auto text-xs text-muted">Visible to clients</span>
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    {...form.register("featured")}
                    className="h-4 w-4 rounded border-border accent-accent"
                  />
                  <span className="text-ink">
                    <Star className="-mt-0.5 mr-1 inline h-3.5 w-3.5" />
                    Featured on home
                  </span>
                </label>
              </div>
            </div>
          </div>

          <div className="mt-8 flex items-center justify-end gap-2 border-t border-border pt-4">
            <Button type="button" variant="ghost" onClick={() => router.push("/admin/workshops")}>
              Cancel
            </Button>
            <Button type="submit" disabled={form.formState.isSubmitting}>
              {workshop ? "Save changes" : "Create workshop"}
            </Button>
          </div>
        </>
      )}
    </Form>
  );
}
