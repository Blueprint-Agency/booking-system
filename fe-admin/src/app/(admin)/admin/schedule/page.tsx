"use client";

import { Suspense, useCallback } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Plus } from "lucide-react";
import { PageHeader, Button } from "@/components/ui";
import { ScheduleCalendar } from "@/components/domain/schedule/schedule-calendar";
import { ScheduleBulkBar } from "@/components/domain/schedule/schedule-bulk-bar";
import { LocationFilterChip } from "@/components/filters/location-filter-chip";

function ScheduleContent() {
  const router = useRouter();
  const params = useSearchParams();
  const locParam = params.get("loc");

  const setLocation = useCallback(
    (locationId: string | null) => {
      const sp = new URLSearchParams(params.toString());
      if (locationId) sp.set("loc", locationId);
      else sp.delete("loc");
      router.replace(`?${sp.toString()}`, { scroll: false });
    },
    [params, router],
  );

  return (
    <>
      <PageHeader
        title="Schedule"
        description="Next 14 days of class occurrences expanded from your templates. Click a date header to bulk-edit."
        actions={
          <Link href="/admin/classes/new">
            <Button>
              <Plus className="mr-1 h-4 w-4" /> New class
            </Button>
          </Link>
        }
      />
      <div className="mt-4">
        <LocationFilterChip value={locParam} onChange={setLocation} />
      </div>
      <div className="mt-4">
        <ScheduleCalendar
          selectionEnabled
          bulkSlot={({ selectedDates, weekStart, clearSelection }) => (
            <ScheduleBulkBar
              selectedDates={selectedDates}
              weekStart={weekStart}
              onClear={clearSelection}
            />
          )}
        />
      </div>
    </>
  );
}

export default function SchedulePage() {
  return (
    <Suspense fallback={null}>
      <ScheduleContent />
    </Suspense>
  );
}
