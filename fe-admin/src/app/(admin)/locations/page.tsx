"use client";

import { useState } from "react";
import type { Location } from "@/types";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { LocationRow } from "@/components/locations/location-row";
import { LocationForm } from "@/components/locations/location-form";
import { useAdminState } from "@/lib/mock-state";

export default function LocationsPage() {
  const state = useAdminState();
  const [editing, setEditing] = useState<Location | null>(null);
  const [creating, setCreating] = useState(false);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Locations"
        description={`${state.locations.length} studios`}
        actions={<Button onClick={() => setCreating(true)}>New location</Button>}
      />
      <div className="overflow-hidden rounded-xl border border-ink/10 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-paper/60 text-left text-[11px] font-semibold uppercase tracking-wide text-ink/60">
            <tr>
              <th className="px-4 py-2">Name</th>
              <th className="px-4 py-2">Address</th>
              <th className="px-4 py-2">Area</th>
              <th className="px-4 py-2">Rooms</th>
              <th className="px-4 py-2">Amenities</th>
              <th className="px-4 py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {state.locations.map((l) => (
              <LocationRow key={l.id} location={l} onEdit={setEditing} />
            ))}
          </tbody>
        </table>
      </div>
      {creating && <LocationForm open={creating} onClose={() => setCreating(false)} />}
      {editing && <LocationForm initial={editing} open={!!editing} onClose={() => setEditing(null)} />}
    </div>
  );
}
