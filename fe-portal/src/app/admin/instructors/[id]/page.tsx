"use client";
import { use, useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { InstructorForm } from "@/components/instructors/instructor-form";
import { useWorkspace } from "@/lib/workspace-context";
import { ApiError } from "@/lib/api";
import type { Instructor } from "@/types";

interface ApiInstructor {
  id: string;
  email: string;
  name: string;
  status: "pending" | "active" | "archived";
  archived_at: string | null;
  bio: string | null;
  phone: string | null;
  photo_r2_key: string | null;
  class_type_ids: string[];
}

export default function InstructorDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const { api } = useWorkspace();
  const [instructor, setInstructor] = useState<Instructor | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!api) return;
    setLoading(true);
    setError(null);
    try {
      const r = await api.get<ApiInstructor>(`/portal/admin/instructors/${id}`);
      setInstructor({
        id: r.id,
        name: r.name,
        email: r.email,
        phone: r.phone ?? "",
        bio: r.bio ?? "",
        photoUrl: null,
        eligibleClassTypeIds: r.class_type_ids,
        archivedAt: r.archived_at,
      });
    } catch (err) {
      setError(err instanceof ApiError ? `HTTP ${err.status}` : "Network error");
    } finally {
      setLoading(false);
    }
  }, [api, id]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center gap-2 text-sm text-muted">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading instructor…
      </div>
    );
  }

  if (error || !instructor) {
    return (
      <div className="mx-auto max-w-3xl rounded-xl border border-error/30 bg-error/5 p-6 text-center">
        <p className="text-sm text-error">
          {error ? `Failed to load: ${error}` : "Instructor not found."}
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl">
      <InstructorForm initial={instructor} />
      <div className="mt-6 grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-border bg-card p-4 shadow-soft">
          <div className="text-xs font-medium uppercase tracking-wide text-muted">
            Avg rating
          </div>
          <div className="mt-1 font-mono text-lg font-semibold text-ink">—</div>
          <div className="text-xs text-muted">Bookings & ratings ship in a later slice</div>
        </div>
        <div className="rounded-xl border border-border bg-card p-4 shadow-soft">
          <div className="text-xs font-medium uppercase tracking-wide text-muted">
            Upcoming classes
          </div>
          <div className="mt-1 font-mono text-lg font-semibold text-ink">—</div>
        </div>
        <div className="rounded-xl border border-border bg-card p-4 shadow-soft">
          <div className="text-xs font-medium uppercase tracking-wide text-muted">
            Total taught
          </div>
          <div className="mt-1 font-mono text-lg font-semibold text-ink">—</div>
        </div>
      </div>
    </div>
  );
}
