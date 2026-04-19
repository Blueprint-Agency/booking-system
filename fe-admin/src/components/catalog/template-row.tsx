"use client";

import type { Instructor, Location, SessionTemplate } from "@/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toggleTemplateActive } from "@/lib/mock-state";

const DAY_LABEL = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

export function TemplateRow({
  template,
  instructors,
  locations,
  onEdit,
}: {
  template: SessionTemplate;
  instructors: Instructor[];
  locations: Location[];
  onEdit: (t: SessionTemplate) => void;
}) {
  const inst = instructors.find((i) => i.id === template.instructorId);
  const loc = locations.find((l) => l.id === template.locationId);
  return (
    <tr className="border-t border-ink/5">
      <td className="px-4 py-3">
        <div className="font-medium text-ink">{template.name}</div>
        <div className="text-xs text-ink/50">{template.category} · {template.level}</div>
      </td>
      <td className="px-4 py-3 text-sm text-ink/70">{inst?.name ?? "—"}</td>
      <td className="px-4 py-3 text-sm text-ink/70">{loc?.shortName ?? "—"}</td>
      <td className="px-4 py-3 font-mono text-sm text-ink/70">
        {DAY_LABEL[template.dayOfWeek]} {template.time} · {template.duration}m
      </td>
      <td className="px-4 py-3 font-mono text-sm text-ink/70">{template.capacity}</td>
      <td className="px-4 py-3">
        {template.active ? <Badge tone="sage">active</Badge> : <Badge tone="neutral">paused</Badge>}
      </td>
      <td className="px-4 py-3 text-right">
        <Button variant="ghost" size="sm" onClick={() => toggleTemplateActive(template.id)}>
          {template.active ? "Pause" : "Resume"}
        </Button>
        <Button variant="ghost" size="sm" onClick={() => onEdit(template)}>
          Edit
        </Button>
      </td>
    </tr>
  );
}
