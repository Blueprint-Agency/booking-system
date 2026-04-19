"use client";

import { useMemo, useState } from "react";
import { PageHeader } from "@/components/ui/page-header";
import { WeekView } from "@/components/schedule/week-view";
import { MonthView } from "@/components/schedule/month-view";
import { ScheduleToolbar } from "@/components/schedule/schedule-toolbar";
import { CreateClassModal } from "@/components/schedule/create-class-modal";
import { useAdminState } from "@/lib/mock-state";
import type { CalendarView } from "@/lib/schedule";
import instructorsData from "@/data/instructors.json";
import locationsData from "@/data/locations.json";
import tenantsData from "@/data/tenants.json";
import type { Instructor, Location, Tenant } from "@/types";

const TODAY = new Date("2026-04-20T00:00:00");

export default function ClassesSchedulePage() {
  const state = useAdminState();
  const instructors = instructorsData as Instructor[];
  const locations = locationsData as Location[];
  const tenantId = (tenantsData as Tenant[])[0].id;

  const [anchor, setAnchor] = useState<Date>(TODAY);
  const [view, setView] = useState<CalendarView>("week");
  const [createOpen, setCreateOpen] = useState(false);

  const sessions = useMemo(
    () => state.sessions.filter((s) => s.type === "regular"),
    [state.sessions],
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Class schedule"
        description="Recurring group classes — week and month views."
      />

      <ScheduleToolbar
        anchor={anchor}
        view={view}
        onAnchorChange={setAnchor}
        onViewChange={setView}
        onToday={() => setAnchor(TODAY)}
        onCreateClass={() => setCreateOpen(true)}
      />

      {view === "week" ? (
        <WeekView anchor={anchor} sessions={sessions} instructors={instructors} today={TODAY} />
      ) : (
        <MonthView anchor={anchor} sessions={sessions} instructors={instructors} today={TODAY} />
      )}

      <CreateClassModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        instructors={instructors}
        locations={locations}
        tenantId={tenantId}
      />
    </div>
  );
}
