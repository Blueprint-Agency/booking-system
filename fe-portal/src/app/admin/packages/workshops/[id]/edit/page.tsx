"use client";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { WorkshopEditor, fromApiWorkshop } from "@/components/workshops/workshop-editor";
import { useStudioZone } from "@/components/brand/brand-provider";
import { useWorkspace } from "@/lib/workspace-context";
import { ApiError } from "@/lib/api";
import type { Workshop } from "@/types";

export default function EditWorkshopPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { api } = useWorkspace();
  const timezone = useStudioZone();
  const [workshop, setWorkshop] = useState<Workshop | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!api) return;
    setLoading(true);
    setError(null);
    try {
      // The BE returns `main_instructor_id` + `supporting_instructor_ids` on the
      // workshop detail; `fromApiWorkshop` maps them onto the editor's Workshop
      // shape so the main/supporting pickers init correctly.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const d = (await api.get(`/portal/admin/workshops/${id}`)) as any;
      setWorkshop(fromApiWorkshop(d, timezone));
    } catch (err) {
      setError(err instanceof ApiError ? `HTTP ${err.status}` : "Network error");
    } finally {
      setLoading(false);
    }
  }, [api, id, timezone]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center gap-2 text-sm text-muted">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading workshop…
      </div>
    );
  }
  if (error || !workshop) {
    return (
      <div className="mx-auto max-w-3xl rounded-xl border border-error/30 bg-error/5 p-6 text-center">
        <p className="text-sm text-error">
          {error ? `Failed to load: ${error}` : "Workshop not found."}
        </p>
      </div>
    );
  }
  // Opened from the workshop's page on the timetable (`?from=schedule`): go
  // back there. Read when leaving, so the page needs no Suspense boundary.
  const back = () =>
    new URLSearchParams(window.location.search).get("from") === "schedule"
      ? `/admin/schedule/workshop/${id}`
      : "/admin/packages/workshops";
  return (
    <WorkshopEditor
      initial={workshop}
      onCancel={() => router.push(back())}
      onSave={() => router.push(back())}
    />
  );
}
