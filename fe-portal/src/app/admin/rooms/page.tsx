"use client";
import { useCallback, useEffect, useState } from "react";
import { Plus, Archive, RotateCcw, Pencil, Loader2, Users, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  Button,
  PageHeader,
  Badge,
  EmptyState,
  Dialog,
  DialogFooter,
  Input,
  Label,
  Tabs,
  TabsList,
  TabsTrigger,
} from "@/components/ui";
import { useWorkspace } from "@/lib/workspace-context";
import { ApiError } from "@/lib/api";

interface ApiRoom {
  id: string;
  location_id: string;
  name: string;
  capacity: number;
  archived_at: string | null;
}

interface Room {
  id: string;
  locationId: string;
  name: string;
  capacity: number;
  archivedAt: string | null;
}

function fromApi(r: ApiRoom): Room {
  return {
    id: r.id,
    locationId: r.location_id,
    name: r.name,
    capacity: r.capacity,
    archivedAt: r.archived_at,
  };
}

type DialogState =
  | { kind: "create" }
  | { kind: "edit"; room: Room }
  | null;

export default function RoomsPage() {
  const { api, accessibleLocations, activeLocationId } = useWorkspace();
  const [rooms, setRooms] = useState<Room[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [view, setView] = useState<"active" | "archived">("active");

  const activeLocationName = accessibleLocations.find((l) => l.id === activeLocationId)?.name;

  const reload = useCallback(async () => {
    if (!api) return;
    setLoading(true);
    setError(null);
    try {
      // Scope to the active workspace — each location has its own room config.
      const params: Record<string, string> = { include_archived: "true" };
      if (activeLocationId) params.location_id = activeLocationId;
      const data = await api.get<{ rooms: ApiRoom[] }>("/portal/admin/rooms", params);
      setRooms(data.rooms.map(fromApi));
    } catch (err) {
      setError(err instanceof ApiError ? `HTTP ${err.status}` : "Network error");
    } finally {
      setLoading(false);
    }
  }, [api, activeLocationId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function handleSave(input: {
    id: string | null;
    locationId: string;
    name: string;
    capacity: number;
  }) {
    if (!api) return;
    try {
      if (input.id) {
        await api.patch(`/portal/admin/rooms/${input.id}`, {
          name: input.name,
          capacity: input.capacity,
        });
      } else {
        await api.post("/portal/admin/rooms", {
          location_id: input.locationId,
          name: input.name,
          capacity: input.capacity,
        });
      }
      setDialog(null);
      await reload();
      toast.success("Room saved.");
    } catch (err) {
      if (err instanceof ApiError) {
        const body = err.body as { error?: string } | null;
        const code = body?.error ?? "";
        if (code === "location_archived") {
          toast.error("That location is archived — pick an active one.");
          return;
        }
        if (err.status === 409) {
          toast.error("A room with that name already exists at this location.");
          return;
        }
        toast.error(`Save failed (HTTP ${err.status}).`);
      } else {
        toast.error("Save failed.");
      }
    }
  }

  async function toggleArchive(room: Room) {
    if (!api) return;
    try {
      if (room.archivedAt) {
        await api.post(`/portal/admin/rooms/${room.id}/unarchive`);
        await reload();
        toast.success("Room restored.");
        return;
      }
      await api.post(`/portal/admin/rooms/${room.id}/archive`);
      await reload();
      toast.success("Room archived.");
    } catch (err) {
      if (err instanceof ApiError) {
        const body = err.body as { error?: string } | null;
        if (body?.error === "room_in_use") {
          toast.error("In use — booked by upcoming classes, workshops, or PT sessions. Reschedule those first.");
          return;
        }
        toast.error(`Archive failed (HTTP ${err.status}).`);
      } else {
        toast.error("Archive failed.");
      }
    }
  }

  async function handleDelete(room: Room) {
    if (!api) return;
    if (!window.confirm("Delete this room? It will be removed from the UI and cannot be restored.")) {
      return;
    }
    try {
      await api.del(`/portal/admin/rooms/${room.id}`);
      setRooms((prev) => prev.filter((r) => r.id !== room.id));
      toast.success("Room deleted.");
    } catch (err) {
      if (err instanceof ApiError) {
        const body = err.body as { error?: string; message?: string } | null;
        toast.error(body?.message ?? body?.error ?? `Delete failed (HTTP ${err.status}).`);
      } else {
        toast.error("Delete failed.");
      }
    }
  }

  const active = rooms.filter((r) => !r.archivedAt);
  const archived = rooms.filter((r) => r.archivedAt);

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Rooms"
        description={
          activeLocationName
            ? `Physical spaces at ${activeLocationName}. Switch location in the topbar to manage another workspace's rooms. Each scheduled class, workshop day, and PT session is assigned a room — the scheduler blocks two sessions sharing a room at overlapping times.`
            : "Physical spaces per location. Each scheduled class, workshop day, and PT session is assigned a room — the scheduler blocks two sessions sharing a room at overlapping times."
        }
        actions={
          <Button onClick={() => setDialog({ kind: "create" })} disabled={!activeLocationId}>
            <Plus className="h-4 w-4" /> Add room
          </Button>
        }
      />

      {!loading && !error && active.length + archived.length > 0 && (
        <Tabs value={view} onValueChange={(v) => setView(v as "active" | "archived")} className="mb-6">
          <TabsList>
            <TabsTrigger value="active">Active ({active.length})</TabsTrigger>
            <TabsTrigger value="archived">Archived ({archived.length})</TabsTrigger>
          </TabsList>
        </Tabs>
      )}

      {loading ? (
        <SkeletonList />
      ) : error ? (
        <ErrorBlock message={error} onRetry={reload} />
      ) : view === "active" ? (
        active.length === 0 ? (
          <EmptyState
            title="No rooms yet"
            description={
              activeLocationName
                ? `Add the first room at ${activeLocationName} to start scheduling.`
                : "Add your first room to start scheduling."
            }
          />
        ) : (
          <RoomList
            rooms={active}
            onEdit={(room) => setDialog({ kind: "edit", room })}
            onArchive={(room) => toggleArchive(room)}
          />
        )
      ) : archived.length === 0 ? (
        <EmptyState
          title="No archived rooms"
          description="Archived rooms will appear here."
        />
      ) : (
        <RoomList
          rooms={archived}
          onEdit={(room) => setDialog({ kind: "edit", room })}
          onArchive={(room) => toggleArchive(room)}
          onDelete={(room) => handleDelete(room)}
          dimmed
        />
      )}

      {dialog && activeLocationId && (
        <RoomDialog
          room={dialog.kind === "edit" ? dialog.room : null}
          locationId={activeLocationId}
          locationName={activeLocationName ?? ""}
          onSave={handleSave}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  );
}

function SkeletonList() {
  return (
    <ul className="mt-6 divide-y divide-border overflow-hidden rounded-xl border border-border bg-card shadow-soft">
      {Array.from({ length: 4 }).map((_, i) => (
        <li key={i} className="flex items-center gap-3 px-4 py-3">
          <div className="h-4 w-32 animate-pulse rounded bg-paper" />
          <div className="h-3 w-16 animate-pulse rounded bg-paper" />
        </li>
      ))}
    </ul>
  );
}

function ErrorBlock({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="mt-6 rounded-xl border border-error/30 bg-error/5 px-4 py-6 text-center">
      <p className="text-sm text-error">Failed to load: {message}</p>
      <Button size="sm" variant="ghost" onClick={onRetry} className="mt-2">
        <Loader2 className="h-3.5 w-3.5" /> Retry
      </Button>
    </div>
  );
}

function RoomList({
  rooms,
  onEdit,
  onArchive,
  onDelete,
  dimmed,
}: {
  rooms: Room[];
  onEdit: (room: Room) => void;
  onArchive: (room: Room) => void;
  onDelete?: (room: Room) => void;
  dimmed?: boolean;
}) {
  return (
    <ul
      className={`divide-y divide-border overflow-hidden rounded-xl border border-border bg-card shadow-soft ${
        dimmed ? "opacity-70" : ""
      }`}
    >
      {rooms.map((room) => {
        const isArchived = !!room.archivedAt;
        return (
          <li
            key={room.id}
            className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-4 py-3"
          >
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium text-ink">{room.name}</span>
                {isArchived && <Badge tone="neutral">Archived</Badge>}
              </div>
              <div className="mt-0.5 flex items-center gap-1 text-xs text-muted">
                <Users className="h-3 w-3" /> Capacity {room.capacity}
              </div>
            </div>
            <div className="ml-auto flex shrink-0 flex-wrap justify-end gap-1">
              <Button size="sm" variant="ghost" onClick={() => onEdit(room)}>
                <Pencil className="h-3.5 w-3.5" /> Edit
              </Button>
              <Button size="sm" variant="ghost" onClick={() => onArchive(room)}>
                {isArchived ? (
                  <>
                    <RotateCcw className="h-3.5 w-3.5" /> Restore
                  </>
                ) : (
                  <>
                    <Archive className="h-3.5 w-3.5" /> Archive
                  </>
                )}
              </Button>
              {isArchived && onDelete && (
                <Button size="sm" variant="ghost" onClick={() => onDelete(room)}>
                  <Trash2 className="h-3.5 w-3.5" /> Delete
                </Button>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function RoomDialog({
  room,
  locationId,
  locationName,
  onSave,
  onClose,
}: {
  room: Room | null;
  locationId: string;
  locationName: string;
  onSave: (input: {
    id: string | null;
    locationId: string;
    name: string;
    capacity: number;
  }) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(room?.name ?? "");
  const [capacity, setCapacity] = useState(String(room?.capacity ?? 20));

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const cap = Number(capacity);
    if (!Number.isInteger(cap) || cap < 1) {
      toast.error("Capacity must be a whole number of at least 1.");
      return;
    }
    onSave({
      // Edits keep the room's own location; new rooms land in the active workspace.
      id: room?.id ?? null,
      locationId: room?.locationId ?? locationId,
      name: name.trim(),
      capacity: cap,
    });
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={room ? "Edit room" : "Add room"}>
      <form className="space-y-4" onSubmit={handleSubmit}>
        <div className="space-y-1.5">
          <Label>Location</Label>
          <div className="rounded-md border border-border bg-paper px-3 py-2 text-sm text-muted">
            {locationName || "—"}
          </div>
          <p className="text-xs text-muted">
            Rooms belong to the active workspace. Switch location in the topbar to manage another.
          </p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="room-name">Name</Label>
          <Input
            id="room-name"
            required
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Studio A, Main Hall"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="room-capacity">Capacity</Label>
          <Input
            id="room-capacity"
            required
            type="number"
            min={1}
            step={1}
            value={capacity}
            onChange={(e) => setCapacity(e.target.value)}
          />
          <p className="text-xs text-muted">
            How many people the room holds. Reference only — it does not cap a session&apos;s
            booking capacity.
          </p>
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit">{room ? "Save" : "Create"}</Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
