"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import { useCurrentTenantId } from "@/lib/admin-auth";
import { upsertNotificationTemplate } from "@/lib/mutations/notifications";
import { PageHeader, Button, Input, Select, Textarea, Label } from "@/components/ui";

export default function NewTemplatePage() {
  const router = useRouter();
  const tid = useCurrentTenantId();
  const [slug, setSlug] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [channel, setChannel] = useState<"email" | "sms">("email");

  const save = () => {
    if (!tid) return;
    if (!slug.trim()) {
      toast.error("Slug required");
      return;
    }
    upsertNotificationTemplate({ tenantId: tid, slug: slug.trim(), subject, body, channel });
    toast.success("Template created");
    router.push("/admin/notifications");
  };

  return (
    <>
      <div className="mb-3 text-xs text-muted">
        <Link href="/admin/notifications" className="inline-flex items-center gap-1 hover:text-ink">
          <ArrowLeft className="h-3 w-3" /> Notifications
        </Link>
      </div>
      <PageHeader title="New template" description="Reusable transactional message." />
      <div className="mt-6 space-y-3">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div>
            <Label>Slug</Label>
            <Input
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              placeholder="booking_reminder"
            />
          </div>
          <div>
            <Label>Channel</Label>
            <Select value={channel} onChange={(e) => setChannel(e.target.value as "email" | "sms")}>
              <option value="email">Email</option>
              <option value="sms">SMS</option>
            </Select>
          </div>
        </div>
        <div>
          <Label>Subject</Label>
          <Input value={subject} onChange={(e) => setSubject(e.target.value)} />
        </div>
        <div>
          <Label>Body</Label>
          <Textarea
            rows={8}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            className="font-mono text-xs"
          />
        </div>
        <div className="flex justify-end">
          <Button type="button" onClick={save}>
            Create template
          </Button>
        </div>
      </div>
    </>
  );
}
