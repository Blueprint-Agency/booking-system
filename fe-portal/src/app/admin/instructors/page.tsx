"use client";
import Link from "next/link";
import { useState } from "react";
import { Plus, Mail, Phone } from "lucide-react";
import { Button, PageHeader, Badge, EmptyState, Avatar } from "@/components/ui";
import { instructors as seedInstructors, classTypes } from "@/data";
import type { Instructor } from "@/types";

export default function InstructorsPage() {
  const [instructors] = useState<Instructor[]>(seedInstructors);
  const ctMap = new Map(classTypes.map((c) => [c.id, c.name]));

  const active = instructors.filter((i) => !i.archivedAt);
  const archived = instructors.filter((i) => i.archivedAt);

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="Instructors"
        description="Saving an instructor sends an automatic invite email — they can teach immediately whether or not the invite is accepted."
        actions={
          <Link href="/admin/instructors/new">
            <Button>
              <Plus className="h-4 w-4" /> Add instructor
            </Button>
          </Link>
        }
      />

      {active.length === 0 ? (
        <EmptyState title="No instructors yet" description="Add your first instructor to begin scheduling classes." />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {active.map((ins) => (
            <InstructorCard key={ins.id} instructor={ins} ctMap={ctMap} />
          ))}
        </div>
      )}

      {archived.length > 0 && (
        <>
          <h2 className="mb-3 mt-10 text-xs font-semibold uppercase tracking-wider text-muted">
            Archived
          </h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {archived.map((ins) => (
              <InstructorCard key={ins.id} instructor={ins} ctMap={ctMap} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function InstructorCard({
  instructor,
  ctMap,
}: {
  instructor: Instructor;
  ctMap: Map<string, string>;
}) {
  const isArchived = !!instructor.archivedAt;
  return (
    <Link
      href={`/admin/instructors/${instructor.id}`}
      className={`block rounded-xl border bg-card p-5 shadow-soft transition ${
        isArchived ? "opacity-70" : "border-border hover:border-accent/40 hover:shadow-hover"
      }`}
    >
      <div className="mb-3 flex items-start gap-3">
        <Avatar name={instructor.name} size={48} />
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-base font-semibold text-ink">{instructor.name}</h3>
          {isArchived && <Badge tone="neutral" className="mt-1">Archived</Badge>}
        </div>
      </div>
      <p className="mb-3 line-clamp-2 text-sm text-muted">{instructor.bio}</p>
      <div className="mb-3 flex flex-wrap gap-1.5">
        {instructor.eligibleClassTypeIds.map((id) => (
          <Badge key={id} tone="cyan">
            {ctMap.get(id) ?? id}
          </Badge>
        ))}
      </div>
      <div className="flex flex-col gap-1 text-xs text-muted">
        <div className="flex items-center gap-1.5">
          <Mail className="h-3 w-3" /> {instructor.email}
        </div>
        <div className="flex items-center gap-1.5 font-mono">
          <Phone className="h-3 w-3" /> {instructor.phone}
        </div>
      </div>
    </Link>
  );
}
