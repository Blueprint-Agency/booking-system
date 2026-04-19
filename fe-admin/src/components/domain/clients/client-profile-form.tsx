"use client";

import { z } from "zod";
import { toast } from "sonner";
import { Input, Textarea, Button } from "@/components/ui";
import { Form, FormField } from "@/components/form";
import { setState } from "@/lib/admin-state";
import { appendAuditEntry } from "@/lib/audit";
import type { Client } from "@/types";

const schema = z.object({
  name: z.string().min(1, "Name required"),
  email: z.string().email("Invalid email"),
  phone: z.string().min(4, "Phone required"),
  tagsCsv: z.string(),
  internalNote: z.string().optional(),
});

type FormValues = z.infer<typeof schema>;

export function ClientProfileForm({ client }: { client: Client }) {
  const defaults: FormValues = {
    name: client.name,
    email: client.email,
    phone: client.phone,
    tagsCsv: client.tags.join(", "),
    internalNote: client.internalNote ?? "",
  };

  const onSubmit = async (v: FormValues) => {
    const tags = v.tagsCsv
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    const before = { ...client };
    const after: Client = {
      ...client,
      name: v.name,
      email: v.email,
      phone: v.phone,
      tags,
      internalNote: v.internalNote?.trim() ? v.internalNote.trim() : null,
    };
    setState((s) => ({
      ...s,
      clients: s.clients.map((c) => (c.id === client.id ? after : c)),
    }));
    appendAuditEntry({
      action: "client.update",
      entityType: "Client",
      entityId: client.id,
      before,
      after,
      note: "Profile edited",
    });
    toast.success("Client updated");
  };

  return (
    <Form schema={schema} defaultValues={defaults} onSubmit={onSubmit}>
      {(form) => (
        <div className="max-w-2xl space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <FormField name="name" label="Name" required>
              <Input id="name" {...form.register("name")} />
            </FormField>
            <FormField name="phone" label="Phone" required>
              <Input id="phone" {...form.register("phone")} />
            </FormField>
          </div>
          <FormField name="email" label="Email" required>
            <Input id="email" type="email" {...form.register("email")} />
          </FormField>
          <FormField name="tagsCsv" label="Tags" hint="Comma-separated">
            <Input id="tagsCsv" {...form.register("tagsCsv")} />
          </FormField>
          <FormField name="internalNote" label="Internal note" hint="Never visible to client">
            <Textarea id="internalNote" rows={3} {...form.register("internalNote")} />
          </FormField>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="submit" disabled={form.formState.isSubmitting || !form.formState.isDirty}>
              Save changes
            </Button>
          </div>
        </div>
      )}
    </Form>
  );
}
