"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import { useAdminState } from "@/lib/admin-state";
import { useCurrentTenantId } from "@/lib/admin-auth";
import { useWithTenant } from "@/lib/tenant-scope";
import { Button, Input, Label, EmptyState } from "@/components/ui";
import { upsertLocation, deleteLocation } from "@/lib/mutations/settings";
import type { Location } from "@/types";

export default function LocationsSettingsPage() {
  const tid = useCurrentTenantId();
  const locations = useWithTenant(useAdminState((s) => s.locations));
  const [editing, setEditing] = useState<Location | null>(null);
  const [draft, setDraft] = useState<Partial<Location>>({});

  const startNew = () => {
    if (!tid) return;
    setEditing({ id: "", tenantId: tid, name: "", shortName: "", address: "", area: "" });
    setDraft({});
  };

  const save = () => {
    if (!editing || !tid) return;
    const merged = { ...editing, ...draft };
    if (!merged.name?.trim() || !merged.address?.trim()) {
      toast.error("Name and address required");
      return;
    }
    upsertLocation({
      id: merged.id || undefined,
      tenantId: tid,
      name: merged.name,
      shortName: merged.shortName ?? "",
      address: merged.address,
      area: merged.area ?? "",
      mapUrl: merged.mapUrl,
      phone: merged.phone,
    });
    toast.success("Location saved");
    setEditing(null);
    setDraft({});
  };

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_360px]">
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-ink">Locations</h2>
          <Button type="button" onClick={startNew}>
            <Plus className="mr-1 h-4 w-4" /> New
          </Button>
        </div>
        {locations.length === 0 ? (
          <EmptyState title="No locations" description="Add your first studio location." />
        ) : (
          <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
            {locations.map((l) => (
              <li
                key={l.id}
                className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-paper"
              >
                <button
                  type="button"
                  onClick={() => {
                    setEditing(l);
                    setDraft({});
                  }}
                  className="flex-1 text-left"
                >
                  <div className="font-medium text-ink">{l.name}</div>
                  <div className="text-xs text-muted">{l.address}</div>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (confirm(`Delete ${l.name}?`)) {
                      deleteLocation(l.id);
                      toast.success("Deleted");
                    }
                  }}
                  className="rounded p-1.5 text-muted hover:bg-paper hover:text-error"
                  aria-label="Delete"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {editing && (
        <div className="rounded-lg border border-border bg-card p-4">
          <h3 className="mb-3 text-sm font-semibold text-ink">
            {editing.id ? "Edit location" : "New location"}
          </h3>
          <div className="space-y-3">
            <div>
              <Label>Name</Label>
              <Input
                value={draft.name ?? editing.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
            </div>
            <div>
              <Label>Short name</Label>
              <Input
                value={draft.shortName ?? editing.shortName}
                onChange={(e) => setDraft({ ...draft, shortName: e.target.value })}
              />
            </div>
            <div>
              <Label>Address</Label>
              <Input
                value={draft.address ?? editing.address}
                onChange={(e) => setDraft({ ...draft, address: e.target.value })}
              />
            </div>
            <div>
              <Label>Area</Label>
              <Input
                value={draft.area ?? editing.area}
                onChange={(e) => setDraft({ ...draft, area: e.target.value })}
              />
            </div>
            <div>
              <Label>Map URL</Label>
              <Input
                value={draft.mapUrl ?? editing.mapUrl ?? ""}
                onChange={(e) => setDraft({ ...draft, mapUrl: e.target.value })}
              />
            </div>
            <div>
              <Label>Phone</Label>
              <Input
                value={draft.phone ?? editing.phone ?? ""}
                onChange={(e) => setDraft({ ...draft, phone: e.target.value })}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setEditing(null);
                  setDraft({});
                }}
              >
                Cancel
              </Button>
              <Button type="button" onClick={save}>
                Save
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
