"use client";
import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { WorkshopEditor } from "@/components/workshops/workshop-editor";
import { slotFromParams } from "@/lib/schedule";

export default function NewWorkshopPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-paper" />}>
      <NewWorkshop />
    </Suspense>
  );
}

function NewWorkshop() {
  const router = useRouter();
  const params = useSearchParams();
  return (
    <WorkshopEditor
      initial={null}
      slot={slotFromParams(params) ?? undefined}
      onCancel={() => router.push("/admin/packages/workshops")}
      onSave={() => router.push("/admin/packages/workshops")}
    />
  );
}
