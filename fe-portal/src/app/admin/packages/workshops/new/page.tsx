"use client";
import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { WorkshopEditor } from "@/components/workshops/workshop-editor";
import type { Slot } from "@/lib/schedule";

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
      slot={slotFromParams(params)}
      onCancel={() => router.push("/admin/packages/workshops")}
      onSave={() => router.push("/admin/packages/workshops")}
    />
  );
}

/** A slot picked off the timetable grid, if this page was opened from there. */
function slotFromParams(params: URLSearchParams): Slot | undefined {
  const date = params.get("date");
  const start = params.get("start");
  const end = params.get("end");
  if (!date || !start || !end) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return undefined;
  if (!/^\d{2}:\d{2}$/.test(start) || !/^\d{2}:\d{2}$/.test(end)) return undefined;
  return { date, start, end };
}
