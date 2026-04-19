"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { useAdminState } from "@/lib/admin-state";
import { PageHeader, EmptyState } from "@/components/ui";
import { TemplateEditor } from "@/components/domain/notifications/template-editor";

export default function TemplateEditorPage() {
  const { slug } = useParams<{ slug: string }>();
  const tmpl = useAdminState((s) => s.notificationTemplates.find((t) => t.slug === slug));
  if (!tmpl && slug !== "new") {
    return <EmptyState title="Template not found" cta={{ href: "/admin/notifications", label: "Back" }} />;
  }
  return (
    <>
      <div className="mb-3 text-xs text-muted">
        <Link href="/admin/notifications" className="inline-flex items-center gap-1 hover:text-ink">
          <ArrowLeft className="h-3 w-3" /> Notifications
        </Link>
      </div>
      <PageHeader
        title={tmpl ? tmpl.slug : "New template"}
        description="Subject and body. Use {{variable}} placeholders."
      />
      <div className="mt-6">
        <TemplateEditor template={tmpl} slug={slug === "new" ? undefined : slug} />
      </div>
    </>
  );
}
