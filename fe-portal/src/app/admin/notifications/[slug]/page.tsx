// FIXTURE-BACKED: reads static mock data from `@/data`, not the live backend.
import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Badge, PageHeader } from "@/components/ui";
import { emailTemplates } from "@/data";
import { TemplateEditor } from "@/components/notifications/template-editor";
import type { EmailTemplateSlug } from "@/types";

export default async function TemplateEditPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const template = emailTemplates.find((t) => t.slug === slug);
  if (!template) notFound();

  return (
    <div className="mx-auto max-w-5xl">
      <Link
        href="/admin/notifications"
        className="mb-2 inline-flex items-center gap-1 text-sm text-muted hover:text-ink"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> All templates
      </Link>
      <PageHeader
        title={template.label}
        description={template.description}
        actions={<Badge tone="accent">{template.category}</Badge>}
      />
      <div className="mb-4 grid gap-3 rounded-xl border border-border bg-card p-4 text-xs shadow-soft sm:grid-cols-2">
        <div>
          <div className="font-medium uppercase tracking-wide text-muted">Trigger</div>
          <div className="mt-0.5 text-ink">{template.trigger}</div>
        </div>
        <div>
          <div className="font-medium uppercase tracking-wide text-muted">Recipient</div>
          <div className="mt-0.5 text-ink">{template.recipient}</div>
        </div>
      </div>
      <TemplateEditor template={template} />
    </div>
  );
}
