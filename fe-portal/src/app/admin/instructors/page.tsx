"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Plus, Mail, Phone, Loader2 } from "lucide-react";
import { Button, PageHeader, Badge, EmptyState, Avatar, Tabs, TabsList, TabsTrigger } from "@/components/ui";
import { useWorkspace } from "@/lib/workspace-context";
import { ApiError } from "@/lib/api";
import type { Instructor } from "@/types";

interface ApiInstructor {
  id: string;
  email: string;
  name: string;
  status: "pending" | "active" | "archived";
  archived_at: string | null;
  invited_at: string | null;
  accepted_at: string | null;
  bio: string | null;
  phone: string | null;
  photo_r2_key: string | null;
}

function instructorFromApi(r: ApiInstructor): Instructor {
  return {
    id: r.id,
    name: r.name,
    email: r.email,
    phone: r.phone ?? "",
    bio: r.bio ?? "",
    photoUrl: null,
    archivedAt: r.archived_at,
  };
}

export default function InstructorsPage() {
  const { api } = useWorkspace();
  const [instructors, setInstructors] = useState<Instructor[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<"active" | "archived">("active");

  const load = useCallback(async () => {
    if (!api) return;
    setLoading(true);
    setError(null);
    try {
      const ins = await api.get<{ instructors: ApiInstructor[] }>(
        "/portal/admin/instructors",
      );
      setInstructors(ins.instructors.map(instructorFromApi));
    } catch (err) {
      setError(err instanceof ApiError ? `HTTP ${err.status}` : "Network error");
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  const active = instructors.filter((i) => !i.archivedAt);
  const archived = instructors.filter((i) => i.archivedAt);

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="Instructors"
        description="Saving an instructor creates a staff record. In v0 the Clerk invitation email is not yet auto-sent — that lands in v1."
        actions={
          <Link href="/admin/instructors/new">
            <Button>
              <Plus className="h-4 w-4" /> Add instructor
            </Button>
          </Link>
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
        <SkeletonGrid />
      ) : error ? (
        <div className="rounded-xl border border-error/30 bg-error/5 px-4 py-6 text-center">
          <p className="text-sm text-error">Failed to load: {error}</p>
          <Button size="sm" variant="ghost" onClick={load} className="mt-2">
            <Loader2 className="h-3.5 w-3.5" /> Retry
          </Button>
        </div>
      ) : active.length === 0 && archived.length === 0 ? (
        <EmptyState
          title="No instructors yet"
          description="Add your first instructor to begin scheduling classes."
        />
      ) : view === "active" ? (
        active.length === 0 ? (
          <EmptyState
            title="No instructors yet"
            description="Add your first instructor to begin scheduling classes."
          />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {active.map((ins) => (
              <InstructorCard key={ins.id} instructor={ins} />
            ))}
          </div>
        )
      ) : archived.length === 0 ? (
        <EmptyState
          title="No archived instructors"
          description="Archived instructors will appear here."
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {archived.map((ins) => (
            <InstructorCard key={ins.id} instructor={ins} />
          ))}
        </div>
      )}
    </div>
  );
}

function SkeletonGrid() {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="rounded-xl border border-border bg-card p-5 shadow-soft">
          <div className="mb-3 flex items-start gap-3">
            <div className="h-12 w-12 animate-pulse rounded-full bg-paper" />
            <div className="flex-1 space-y-2">
              <div className="h-4 w-32 animate-pulse rounded bg-paper" />
              <div className="h-3 w-48 animate-pulse rounded bg-paper" />
            </div>
          </div>
          <div className="h-3 w-full animate-pulse rounded bg-paper" />
        </div>
      ))}
    </div>
  );
}

function InstructorCard({ instructor }: { instructor: Instructor }) {
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
      <div className="flex flex-col gap-1 text-xs text-muted">
        <div className="flex items-center gap-1.5">
          <Mail className="h-3 w-3" /> {instructor.email}
        </div>
        {instructor.phone && (
          <div className="flex items-center gap-1.5 font-mono">
            <Phone className="h-3 w-3" /> {instructor.phone}
          </div>
        )}
      </div>
    </Link>
  );
}
