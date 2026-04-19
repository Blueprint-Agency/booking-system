"use client";

import Link from "next/link";
import { Plus, Send, ChevronRight } from "lucide-react";
import { useAdminState } from "@/lib/admin-state";
import { useWithTenant } from "@/lib/tenant-scope";
import { PageHeader, Button, Badge, EmptyState, StatusBadge } from "@/components/ui";
import { formatRelative } from "@/lib/formatters";

export default function NotificationsPage() {
  const templates = useWithTenant(useAdminState((s) => s.notificationTemplates));
  const broadcasts = useWithTenant(useAdminState((s) => s.broadcasts));

  return (
    <>
      <PageHeader
        title="Notifications"
        description="Templates for transactional messages and one-off broadcasts."
        actions={
          <Link href="/admin/notifications/broadcast/new">
            <Button>
              <Send className="mr-1 h-4 w-4" /> New broadcast
            </Button>
          </Link>
        }
      />
      <div className="mt-6 grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div>
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-ink">Templates</h2>
            <Link
              href="/admin/notifications/templates/new"
              className="text-xs text-accent hover:underline"
            >
              <Plus className="-mt-0.5 mr-0.5 inline h-3 w-3" /> New
            </Link>
          </div>
          {templates.length === 0 ? (
            <EmptyState title="No templates" description="Create reusable email templates. (Email-only in v1.)" />
          ) : (
            <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
              {templates.map((t) => (
                <li key={t.slug}>
                  <Link
                    href={`/admin/notifications/templates/${t.slug}`}
                    className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-paper"
                  >
                    <div>
                      <div className="font-medium text-ink">{t.slug}</div>
                      <div className="text-xs text-muted">{t.subject}</div>
                    </div>
                    <Badge tone="neutral">{t.channel}</Badge>
                    <ChevronRight className="h-4 w-4 text-muted" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <h2 className="mb-2 text-sm font-semibold text-ink">Recent broadcasts</h2>
          {broadcasts.length === 0 ? (
            <EmptyState
              title="No broadcasts yet"
              description="Composed broadcasts and their send status appear here."
            />
          ) : (
            <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
              {broadcasts.slice(0, 10).map((b) => (
                <li key={b.id} className="flex items-center justify-between gap-3 px-4 py-3">
                  <div>
                    <div className="font-medium text-ink">{b.subject}</div>
                    <div className="text-xs text-muted">
                      {b.sentAt
                        ? `Sent ${formatRelative(b.sentAt)}`
                        : b.scheduledAt
                          ? `Scheduled ${formatRelative(b.scheduledAt)}`
                          : "Draft"}
                    </div>
                  </div>
                  <StatusBadge status={b.status} />
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </>
  );
}
