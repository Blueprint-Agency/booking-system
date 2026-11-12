"use client";
import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { WorkshopEditor } from "@/components/workshops/workshop-editor";
import { slotFromParams } from "@/lib/schedule";

/**
 * A new workshop, started from the Schedule: "+ Workshop" arms the grid and the
 * slot picked becomes the workshop's first day. Saving or leaving goes back to
 * the timetable, which opens on the week it was left on.
 */
export default function NewWorkshopPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-paper" />}>
      <NewWorkshop />
    </Suspense>
  );
}

function NewWorkshop() {
  const router = useRouter();
  const slot = slotFromParams(useSearchParams());
  const back = "/admin/schedule";
  return (
    <WorkshopEditor
      initial={null}
      slot={slot ?? undefined}
      back={{ href: back, label: "Back to Schedule" }}
      onCancel={() => router.push(back)}
      onSave={() => router.push(back)}
    />
  );
}
