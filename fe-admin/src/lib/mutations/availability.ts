"use client";

import { setState } from "@/lib/admin-state";
import { appendAuditEntry } from "@/lib/audit";
import type { AvailabilityBlockoff, AvailabilityTemplate } from "@/types";

function newId(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function emptyWeekly(): boolean[][] {
  return Array.from({ length: 7 }, () => Array.from({ length: 48 }, () => false));
}

export function setAvailabilityTemplate(
  instructorId: string,
  weekly: boolean[][],
): AvailabilityTemplate {
  let resultRef: AvailabilityTemplate | null = null;
  setState((s) => {
    const existing = s.availabilityTemplates.find((t) => t.instructorId === instructorId);
    let templates = s.availabilityTemplates;
    if (existing) {
      const next: AvailabilityTemplate = { ...existing, weekly };
      resultRef = next;
      templates = templates.map((t) => (t.id === existing.id ? next : t));
    } else {
      const next: AvailabilityTemplate = {
        id: newId("avt"),
        instructorId,
        weekly,
      };
      resultRef = next;
      templates = [next, ...templates];
    }
    return { ...s, availabilityTemplates: templates };
  });
  const result = resultRef as AvailabilityTemplate | null;
  if (!result) throw new Error("Could not save");
  appendAuditEntry({
    action: "session.update",
    entityType: "AvailabilityTemplate",
    entityId: result.id,
    before: null,
    after: result,
    note: `Updated weekly availability for ${instructorId}`,
  });
  return result;
}

export interface AddBlockoffInput {
  instructorId: string;
  startAt: string;
  endAt: string;
  reason: string;
}

export function addBlockoff(input: AddBlockoffInput): AvailabilityBlockoff {
  const blockoff: AvailabilityBlockoff = {
    id: newId("blk"),
    instructorId: input.instructorId,
    startAt: input.startAt,
    endAt: input.endAt,
    reason: input.reason || null,
  };
  setState((s) => ({
    ...s,
    availabilityBlockoffs: [blockoff, ...s.availabilityBlockoffs],
  }));
  return blockoff;
}

export function removeBlockoff(id: string) {
  setState((s) => ({
    ...s,
    availabilityBlockoffs: s.availabilityBlockoffs.filter((b) => b.id !== id),
  }));
}
