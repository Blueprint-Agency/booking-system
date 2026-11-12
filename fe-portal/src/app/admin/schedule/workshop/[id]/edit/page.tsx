"use client";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { WorkshopEditor, fromApiWorkshop } from "@/components/workshops/workshop-editor";
import { ErrorDetail, LoadingDetail, type DetailBack } from "@/components/schedule/event-detail";
import { useStudioZone } from "@/components/brand/brand-provider";
import { useWorkspace } from "@/lib/workspace-context";
import { ApiError } from "@/lib/api";
import type { Workshop } from "@/types";

const BACK: DetailBack = { href: "/admin/schedule", label: "Back to Schedule" };

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
      setError(
        err instanceof ApiError
          ? err.status === 404
            ? "Workshop not found."
            : `Failed to load: HTTP ${err.status}`
          : "Failed to load: network error",
      );
    } finally {
      setLoading(false);
    }
  }, [api, id, timezone]);

  useEffect(() => {
    void load();
  }, [load]);

  // Opened straight from the timetable: saving or leaving goes back there.
  if (loading) return <LoadingDetail back={BACK} label="workshop" />;
  if (error || !workshop) return <ErrorDetail back={BACK} kind="Workshop" message={error ?? "Workshop not found."} />;
  return (
    <WorkshopEditor
      initial={workshop}
      back={BACK}
      onCancel={() => router.push(BACK.href)}
      onSave={() => router.push(BACK.href)}
    />
  );
}
