"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Send } from "lucide-react";
import { useAdminState } from "@/lib/admin-state";
import { useCurrentTenantId } from "@/lib/admin-auth";
import { useWithTenant } from "@/lib/tenant-scope";
import { Button, Input, Select, Textarea, Label } from "@/components/ui";
import { AudiencePicker } from "./audience-picker";
import { sendBroadcast } from "@/lib/mutations/notifications";
import type { Broadcast } from "@/types";

export function BroadcastComposer() {
  const router = useRouter();
  const tid = useCurrentTenantId();
  const templates = useWithTenant(useAdminState((s) => s.notificationTemplates));
  const [templateSlug, setTemplateSlug] = useState<string>("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [audience, setAudience] = useState<Broadcast["audience"]>({ kind: "all" });
  const [scheduleAt, setScheduleAt] = useState<string>("");

  const applyTemplate = (slug: string) => {
    setTemplateSlug(slug);
    const t = templates.find((x) => x.slug === slug);
    if (t) {
      setSubject(t.subject);
      setBody(t.body);
    }
  };

  const send = (immediate: boolean) => {
    if (!tid) {
      toast.error("No tenant");
      return;
    }
    if (!subject.trim() || !body.trim()) {
      toast.error("Subject and body required");
      return;
    }
    sendBroadcast({
      tenantId: tid,
      templateSlug: templateSlug || null,
      subject,
      body,
      audience,
      scheduledAt: immediate ? undefined : scheduleAt ? new Date(scheduleAt).toISOString() : undefined,
    });
    toast.success(immediate ? "Broadcast sent" : "Broadcast scheduled");
    router.push("/admin/notifications");
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-6">
      <div className="space-y-4">
        <div>
          <Label>Template</Label>
          <Select value={templateSlug} onChange={(e) => applyTemplate(e.target.value)}>
            <option value="">â€” No template (write fresh) â€”</option>
            {templates.map((t) => (
              <option key={t.slug} value={t.slug}>
                {t.slug} Â· {t.channel}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label>Subject</Label>
          <Input value={subject} onChange={(e) => setSubject(e.target.value)} />
        </div>
        <div>
          <Label>Body</Label>
          <Textarea
            rows={10}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            className="font-mono text-xs"
          />
        </div>
      </div>
      <div className="space-y-4">
        <AudiencePicker value={audience} onChange={setAudience} />
        <div className="rounded-lg border border-border bg-card p-4">
          <Label>Send</Label>
          <Input
            type="datetime-local"
            value={scheduleAt}
            onChange={(e) => setScheduleAt(e.target.value)}
            className="mt-2"
          />
          <p className="mt-1 text-xs text-muted">Leave blank to send now.</p>
          <div className="mt-3 flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => send(false)} disabled={!scheduleAt}>
              Schedule
            </Button>
            <Button type="button" onClick={() => send(true)}>
              <Send className="mr-1 h-4 w-4" /> Send now
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
