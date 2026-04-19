"use client";

import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { useAdminState } from "@/lib/admin-state";
import { PageHeader, Badge } from "@/components/ui";

export default function FactoryTemplatesPage() {
  const templates = useAdminState((s) => s.notificationTemplates);

  return (
    <>
      <PageHeader
        title="Factory templates"
        description="Default notification templates seeded into every studio. Edit cautiously — changes affect all flows."
      />
      <div className="mt-6 rounded-lg border border-border bg-card">
        {templates.length === 0 ? (
          <p className="px-4 py-6 text-sm text-muted">No templates.</p>
        ) : (
          <ul className="divide-y divide-border">
            {templates.map((t) => (
              <li key={t.slug}>
                <Link
                  href={`/admin/notifications/templates/${t.slug}`}
                  className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-paper"
                >
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-ink">{t.slug}</div>
                    <div className="truncate text-xs text-muted">{t.subject}</div>
                  </div>
                  <Badge tone="neutral">{t.channel}</Badge>
                  <ChevronRight className="h-4 w-4 text-muted" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
