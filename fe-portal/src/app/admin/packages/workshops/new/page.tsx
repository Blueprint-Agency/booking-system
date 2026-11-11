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
  const slot = slotFromParams(params);
  // Opened from a slot on the timetable: go back to it, which opens on the
  // week it was left on. Opened from Workshops: back to that list.
  const back = slot ? "/admin/schedule" : "/admin/packages/workshops";
  return (
    <WorkshopEditor
      initial={null}
      slot={slot ?? undefined}
      onCancel={() => router.push(back)}
      onSave={() => router.push(back)}
    />
  );
}
