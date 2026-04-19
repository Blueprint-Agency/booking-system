"use client";

import { useState } from "react";
import type { Instructor } from "@/types";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { InstructorRow } from "@/components/instructors/instructor-row";
import { InstructorForm } from "@/components/instructors/instructor-form";
import { useAdminState } from "@/lib/mock-state";

export default function InstructorsPage() {
  const state = useAdminState();
  const [editing, setEditing] = useState<Instructor | null>(null);
  const [creating, setCreating] = useState(false);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Instructors"
        description={`${state.instructors.length} total`}
        actions={<Button onClick={() => setCreating(true)}>New instructor</Button>}
      />

      <div className="overflow-hidden rounded-xl border border-ink/10 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-paper/60 text-left text-[11px] font-semibold uppercase tracking-wide text-ink/60">
            <tr>
              <th className="px-4 py-2">Name</th>
              <th className="px-4 py-2">Specialties</th>
              <th className="px-4 py-2">Upcoming</th>
              <th className="px-4 py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {state.instructors.map((i) => (
              <InstructorRow
                key={i.id}
                instructor={i}
                sessions={state.sessions}
                onEdit={setEditing}
              />
            ))}
          </tbody>
        </table>
        {state.instructors.length === 0 && (
          <div className="p-8 text-center text-sm text-ink/50">No instructors yet.</div>
        )}
      </div>

      {creating && <InstructorForm open={creating} onClose={() => setCreating(false)} />}
      {editing && (
        <InstructorForm initial={editing} open={!!editing} onClose={() => setEditing(null)} />
      )}
    </div>
  );
}
