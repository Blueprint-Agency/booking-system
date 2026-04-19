"use client";

import { Badge } from "@/components/ui";

export interface SlaChipProps {
  dueAt: string;
}

export function SlaChip({ dueAt }: SlaChipProps) {
  const ms = Date.parse(dueAt) - Date.now();
  const hours = ms / (1000 * 60 * 60);
  if (hours < 0) {
    return <Badge tone="error">Overdue {Math.abs(Math.round(hours))}h</Badge>;
  }
  if (hours < 4) {
    return <Badge tone="warning">{Math.round(hours)}h left</Badge>;
  }
  return <Badge tone="neutral">{Math.round(hours)}h left</Badge>;
}
