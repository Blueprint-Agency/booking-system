"use client";

import Link from "next/link";
import type { Instructor, Session } from "@/types";
import { Button } from "@/components/ui/button";

export function InstructorRow({
  instructor,
  sessions,
  onEdit,
}: {
  instructor: Instructor;
  sessions: Session[];
  onEdit: (i: Instructor) => void;
}) {
  const upcoming = sessions.filter(
    (s) => s.instructorId === instructor.id && s.status === "scheduled" && s.date >= "2026-04-20",
  ).length;
  return (
    <tr className="border-t border-ink/5">
      <td className="px-4 py-3">
        <Link
          href={`/instructors/${instructor.id}`}
          className="font-medium text-ink hover:text-accent"
        >
          {instructor.name}
        </Link>
        <div className="text-xs text-ink/50 line-clamp-1">{instructor.bio}</div>
      </td>
      <td className="px-4 py-3 text-sm text-ink/70">{instructor.specialties.join(", ") || "—"}</td>
      <td className="px-4 py-3 font-mono text-sm text-ink/70">{upcoming}</td>
      <td className="px-4 py-3 text-right">
        <Button variant="ghost" size="sm" onClick={() => onEdit(instructor)}>Edit</Button>
      </td>
    </tr>
  );
}
