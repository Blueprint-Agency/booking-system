"use client";

import { useParams } from "next/navigation";
import { useAdminState } from "@/lib/admin-state";
import { PageHeader, EmptyState } from "@/components/ui";
import { ClassTemplateForm } from "@/components/domain/schedule/class-template-form";
import { AuditTimeline } from "@/components/audit/audit-timeline";

export default function EditClassPage() {
  const { id } = useParams<{ id: string }>();
  const template = useAdminState((s) => s.sessionTemplates.find((t) => t.id === id));

  if (!template) {
    return (
      <EmptyState
        title="Template not found"
        description="This class template doesn't exist or isn't in your tenant."
        cta={{ href: "/admin/classes", label: "Back to Classes" }}
      />
    );
  }

  return (
    <>
      <PageHeader
        title={template.name}
        description="Edit the recurring schedule, instructor, and pricing."
      />
      <div className="mt-6">
        <ClassTemplateForm template={template} />
      </div>
      <div className="mt-8">
        <h3 className="mb-3 text-sm font-semibold text-ink">Audit history</h3>
        <AuditTimeline targetId={template.id} />
      </div>
    </>
  );
}
