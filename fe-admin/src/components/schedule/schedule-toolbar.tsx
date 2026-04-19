"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatAnchorLabel, stepAnchor, type CalendarView } from "@/lib/schedule";

export function ScheduleToolbar({
  anchor,
  view,
  onAnchorChange,
  onViewChange,
  onToday,
  onCreateClass,
  onAddWorkshop,
}: {
  anchor: Date;
  view: CalendarView;
  onAnchorChange: (d: Date) => void;
  onViewChange: (v: CalendarView) => void;
  onToday: () => void;
  onCreateClass: () => void;
  onAddWorkshop: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onAnchorChange(stepAnchor(anchor, view, -1))}
          aria-label="Previous"
          className="!px-2"
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onAnchorChange(stepAnchor(anchor, view, 1))}
          aria-label="Next"
          className="!px-2"
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="sm" onClick={onToday}>Today</Button>
        <span className="ml-2 text-lg font-semibold text-ink">{formatAnchorLabel(anchor, view)}</span>
      </div>
      <div className="flex items-center gap-2">
        <div className="inline-flex rounded-lg border border-ink/10 bg-white p-0.5">
          {(["week", "month"] as const).map((v) => (
            <button
              key={v}
              onClick={() => onViewChange(v)}
              className={
                "rounded-md px-3 py-1 text-sm capitalize " +
                (view === v ? "bg-accent text-white" : "text-ink/70 hover:text-ink")
              }
            >
              {v}
            </button>
          ))}
        </div>
        <Button variant="secondary" size="sm" onClick={onAddWorkshop}>Add workshop</Button>
        <Button variant="primary" size="sm" onClick={onCreateClass}>Create class</Button>
      </div>
    </div>
  );
}
