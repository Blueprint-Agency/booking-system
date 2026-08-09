// FIXTURE-BACKED: reads static mock data from `@/data`, not the live backend.
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { Badge, PageHeader } from "@/components/ui";
import { emailTemplates } from "@/data";
import { formatRelative } from "@/lib/formatters";

export default function NotificationsPage() {
  // Group by category preserving order
  const groups: { category: string; templates: typeof emailTemplates }[] = [];
  for (const t of emailTemplates) {
    let g = groups.find((x) => x.category === t.category);
    if (!g) {
      g = { category: t.category, templates: [] };
      groups.push(g);
    }
    g.templates.push(t);
  }

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title="Notifications"
        description="21 transactional email templates. Every trigger always fires — there's no enable/disable toggle. Edit subject and body to match the studio voice."
      />

      <div className="space-y-6">
        {groups.map((group) => (
          <section key={group.category}>
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted">
              {group.category}
            </h2>
            <div className="rounded-xl border border-border bg-card shadow-soft">
              <ul className="divide-y divide-border">
                {group.templates.map((t) => (
                  <li key={t.slug}>
                    <Link
                      href={`/admin/notifications/${t.slug}`}
                      className="flex items-center gap-4 px-5 py-3 transition hover:bg-paper"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="font-medium text-ink">{t.label}</div>
                        <div className="text-xs text-muted">{t.description}</div>
                      </div>
                      <div className="hidden text-xs text-muted md:block">
                        {t.variables.length} variable{t.variables.length === 1 ? "" : "s"}
                      </div>
                      <span className="text-xs text-muted">
                        Updated {formatRelative(t.updatedAt)}
                      </span>
                      <ChevronRight className="h-4 w-4 text-muted" />
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
