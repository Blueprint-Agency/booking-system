"use client";

import { PageHeader } from "@/components/ui";
import { ClassTemplateForm } from "@/components/domain/schedule/class-template-form";

export default function NewClassPage() {
  return (
    <>
      <PageHeader
        title="New class template"
        description="Define the recurring schedule, default instructor, and pricing."
      />
      <div className="mt-6">
        <ClassTemplateForm />
      </div>
    </>
  );
}
