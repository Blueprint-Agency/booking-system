"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { useAdminState, setState, STUDIO_TENANT_ID } from "@/lib/admin-state";
import {
  PageHeader,
  Badge,
  EmptyState,
  Button,
  Dialog,
  DialogFooter,
  Input,
  Label,
  Textarea,
} from "@/components/ui";
import { DataTable, type DataTableColumn } from "@/components/data-table";
import type { Instructor } from "@/types";

interface DraftInstructor {
  name: string;
  email: string;
  phone: string;
  bio: string;
  locationIds: string[];
  available: boolean;
}

const emptyDraft: DraftInstructor = {
  name: "",
  email: "",
  phone: "",
  bio: "",
  locationIds: [],
  available: true,
};

export default function InstructorsPage() {
  const instructors = useAdminState((s) => s.instructors);
  const locations = useAdminState((s) => s.locations);
  const sessions = useAdminState((s) => s.sessions);

  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<DraftInstructor>(emptyDraft);

  const locationById = new Map(locations.map((l) => [l.id, l.shortName]));

  const today = new Date().toISOString().slice(0, 10);
  const sessionCountById = new Map<string, number>();
  for (const s of sessions) {
    if (s.date >= today) {
      sessionCountById.set(s.instructorId, (sessionCountById.get(s.instructorId) ?? 0) + 1);
    }
  }

  function toggleLocation(id: string) {
    setDraft((d) => ({
      ...d,
      locationIds: d.locationIds.includes(id)
        ? d.locationIds.filter((x) => x !== id)
        : [...d.locationIds, id],
    }));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!draft.name.trim() || !draft.email.trim()) {
      toast.error("Name and email are required");
      return;
    }
    if (draft.locationIds.length === 0) {
      toast.error("Pick at least one location");
      return;
    }
    const newInstructor: Instructor = {
      id: `ins-${Date.now().toString(36)}`,
      tenantId: STUDIO_TENANT_ID,
      name: draft.name.trim(),
      email: draft.email.trim(),
      phone: draft.phone.trim(),
      bio: draft.bio.trim(),
      avatarUrl: "",
      available: draft.available,
      locationIds: draft.locationIds,
      payRateCents: 0,
      payModel: "flat",
      availabilityTemplateId: null,
    };
    setState((s) => ({ ...s, instructors: [...s.instructors, newInstructor] }));
    toast.success(`${newInstructor.name} added`);
    setDraft(emptyDraft);
    setOpen(false);
  }

  const columns: DataTableColumn<Instructor>[] = [
    {
      key: "name",
      header: "Instructor",
      sortable: true,
      sortValue: (i) => i.name,
      cell: (i) => <span className="font-medium text-ink">{i.name}</span>,
    },
    {
      key: "email",
      header: "Email",
      cell: (i) => <span className="text-sm text-muted">{i.email}</span>,
    },
    {
      key: "locations",
      header: "Locations",
      cell: (i) => (
        <div className="flex flex-wrap gap-1">
          {i.locationIds.map((lid) => (
            <Badge key={lid} tone="neutral">{locationById.get(lid) ?? lid}</Badge>
          ))}
        </div>
      ),
    },
    {
      key: "bio",
      header: "Specialisation",
      cell: (i) => <span className="text-sm text-muted">{i.bio}</span>,
    },
    {
      key: "upcoming",
      header: "Upcoming sessions",
      align: "right",
      cell: (i) => (
        <span className="text-sm tabular-nums">{sessionCountById.get(i.id) ?? 0}</span>
      ),
    },
    {
      key: "status",
      header: "",
      align: "right",
      cell: (i) =>
        i.available ? (
          <Badge tone="sage">Active</Badge>
        ) : (
          <Badge tone="neutral">Inactive</Badge>
        ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Instructors"
        description="Teaching staff at Yoga Sadhana."
        actions={
          <Button onClick={() => setOpen(true)}>
            <Plus className="h-4 w-4" /> Add instructor
          </Button>
        }
      />
      <div className="mt-6">
        <DataTable<Instructor>
          rows={instructors}
          columns={columns}
          rowKey={(i) => i.id}
          empty={
            <EmptyState
              title="No instructors yet"
              description="Add your first teaching staff member to get started."
            />
          }
        />
      </div>

      <Dialog
        open={open}
        onOpenChange={setOpen}
        title="Add instructor"
        description="They'll appear in the schedule and can be assigned to classes."
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="ins-name">Name</Label>
              <Input
                id="ins-name"
                required
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ins-email">Email</Label>
              <Input
                id="ins-email"
                type="email"
                required
                value={draft.email}
                onChange={(e) => setDraft({ ...draft, email: e.target.value })}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="ins-phone">Phone</Label>
            <Input
              id="ins-phone"
              type="tel"
              value={draft.phone}
              onChange={(e) => setDraft({ ...draft, phone: e.target.value })}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="ins-bio">Specialisation</Label>
            <Textarea
              id="ins-bio"
              rows={3}
              placeholder="e.g. Vinyasa, Yin, breathwork"
              value={draft.bio}
              onChange={(e) => setDraft({ ...draft, bio: e.target.value })}
            />
          </div>

          <div className="space-y-2">
            <Label>Locations</Label>
            <div className="flex flex-wrap gap-2">
              {locations.map((loc) => {
                const checked = draft.locationIds.includes(loc.id);
                return (
                  <label
                    key={loc.id}
                    className={
                      "inline-flex cursor-pointer items-center gap-2 rounded-md border px-3 py-1.5 text-sm transition-colors " +
                      (checked
                        ? "border-accent bg-accent/10 text-accent"
                        : "border-border bg-paper text-ink hover:bg-card")
                    }
                  >
                    <input
                      type="checkbox"
                      className="sr-only"
                      checked={checked}
                      onChange={() => toggleLocation(loc.id)}
                    />
                    {loc.shortName}
                  </label>
                );
              })}
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm text-ink">
            <input
              type="checkbox"
              checked={draft.available}
              onChange={(e) => setDraft({ ...draft, available: e.target.checked })}
            />
            Available for scheduling
          </label>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit">Add instructor</Button>
          </DialogFooter>
        </form>
      </Dialog>
    </>
  );
}
