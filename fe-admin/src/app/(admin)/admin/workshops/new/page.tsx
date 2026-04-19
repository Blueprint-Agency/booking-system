"use client";

import { PageHeader } from "@/components/ui";
import { WorkshopForm } from "@/components/domain/workshops/workshop-form";

export default function NewWorkshopPage() {
  return (
    <>
      <PageHeader
        title="New workshop"
        description="One-off session with hero image and tiered pricing."
      />
      <div className="mt-6">
        <WorkshopForm />
      </div>
    </>
  );
}
