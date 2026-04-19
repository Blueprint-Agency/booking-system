"use client";

import { useState } from "react";
import type { SessionTemplate } from "@/types";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { TemplateRow } from "@/components/catalog/template-row";
import { TemplateForm } from "@/components/catalog/template-form";
import { useAdminState } from "@/lib/mock-state";

export default function ClassTemplatesPage() {
  const state = useAdminState();
  const [editing, setEditing] = useState<SessionTemplate | null>(null);
  const [creating, setCreating] = useState(false);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Class templates"
        description="Recurring class definitions. Use Schedule → Create class to generate instances."
        actions={<Button onClick={() => setCreating(true)}>New template</Button>}
      />

      <div className="overflow-hidden rounded-xl border border-ink/10 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-paper/60 text-left text-[11px] font-semibold uppercase tracking-wide text-ink/60">
            <tr>
              <th className="px-4 py-2">Name</th>
              <th className="px-4 py-2">Instructor</th>
              <th className="px-4 py-2">Location</th>
              <th className="px-4 py-2">When</th>
              <th className="px-4 py-2">Capacity</th>
              <th className="px-4 py-2">Status</th>
              <th className="px-4 py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {state.sessionTemplates.map((t) => (
              <TemplateRow
                key={t.id}
                template={t}
                instructors={state.instructors}
                locations={state.locations}
                onEdit={setEditing}
              />
            ))}
          </tbody>
        </table>
        {state.sessionTemplates.length === 0 && (
          <div className="p-8 text-center text-sm text-ink/50">No templates yet.</div>
        )}
      </div>

      {creating && (
        <TemplateForm
          instructors={state.instructors}
          locations={state.locations}
          open={creating}
          onClose={() => setCreating(false)}
        />
      )}
      {editing && (
        <TemplateForm
          initial={editing}
          instructors={state.instructors}
          locations={state.locations}
          open={!!editing}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}
