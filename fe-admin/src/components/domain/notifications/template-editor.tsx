"use client";

import { useState } from "react";
import { toast } from "sonner";
import { useAdminState } from "@/lib/admin-state";
import { useCurrentTenantId } from "@/lib/admin-auth";
import { Button, Input, Select, Textarea, Label } from "@/components/ui";
import { upsertNotificationTemplate } from "@/lib/mutations/notifications";
import type { NotificationTemplate } from "@/types";

export interface TemplateEditorProps {
  template?: NotificationTemplate;
  slug?: string;
}

function highlight(text: string): string {
  return text.replace(/\{\{(\w+)\}\}/g, "{{$1}}");
}

export function TemplateEditor({ template, slug }: TemplateEditorProps) {
  const tid = useCurrentTenantId();
  const [subject, setSubject] = useState(template?.subject ?? "");
  const [body, setBody] = useState(template?.body ?? "");
  const [channel, setChannel] = useState<NotificationTemplate["channel"]>(template?.channel ?? "email");
  const me = useAdminState((s) =>
    s.auth.userId ? s.adminUsers.find((u) => u.id === s.auth.userId) : undefined,
  );

  const save = () => {
    if (!tid) return;
    if (!slug && !template) {
      toast.error("Slug required");
      return;
    }
    const finalSlug = template?.slug ?? slug!;
    upsertNotificationTemplate({
      tenantId: tid,
      slug: finalSlug,
      subject,
      body,
      channel,
    });
    toast.success("Template saved");
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div>
          <Label>Subject</Label>
          <Input value={subject} onChange={(e) => setSubject(e.target.value)} />
        </div>
        <div>
          <Label>Channel</Label>
          <Select
            value={channel}
            onChange={(e) => setChannel(e.target.value as NotificationTemplate["channel"])}
          >
            <option value="email">Email</option>
            <option value="sms">SMS</option>
          </Select>
        </div>
      </div>
      <div>
        <Label>Body</Label>
        <Textarea
          rows={10}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          className="font-mono text-xs"
        />
        <p className="mt-1 text-xs text-muted">
          Variables: <code className="font-mono">{`{{name}}`}</code>,{" "}
          <code className="font-mono">{`{{session_name}}`}</code>,{" "}
          <code className="font-mono">{`{{date}}`}</code>
        </p>
      </div>
      <div>
        <Label>Preview</Label>
        <pre className="whitespace-pre-wrap rounded-md border border-border bg-paper/40 p-3 text-xs text-ink">
{highlight(body)}
        </pre>
      </div>
      <div className="flex justify-end">
        <Button type="button" onClick={save}>
          Save template
        </Button>
      </div>
      {me && (
        <p className="text-xs text-muted">
          Editing as {me.name}. Template edits are not audit-logged; only sending is.
        </p>
      )}
    </div>
  );
}
