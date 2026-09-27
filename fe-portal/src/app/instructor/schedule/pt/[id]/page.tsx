"use client";
import { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Ban, Loader2 } from "lucide-react";
import { Badge, Button } from "@/components/ui";
import { PtSessionMembers } from "@/components/schedule/pt-session-members";
import { useWorkspace } from "@/lib/workspace-context";
import { ApiError } from "@/lib/api";
import { computeEventState } from "@/lib/event-state";
import { formatDate, formatTime } from "@/lib/formatters";
import { fetchInstructorPt, type InstructorPtDetail } from "@/lib/schedule";
import { cancelSession, isManual, ptCancelConfirm, sessionActionErrorMessage, sessionTypeLabel } from "@/lib/pt-manual";

/**
 * A private session the instructor runs (#338): who is on it and the package
 * paying each seat, with the Admin's page's member actions on a manual one —
 * remove a member, fill a free seat — and cancelling it. No pay, no editing
 * and no type change: those are the admin's page.
 */
export default function InstructorPtPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { api } = useWorkspace();
  const [data, setData] = useState<InstructorPtDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!api) return;
    setLoading(true);
    setError(null);
    try {
      setData(await fetchInstructorPt(api, id));
    } catch (err) {
      setError(
        !(err instanceof ApiError)
          ? "Network error"
          : err.status === 403
            ? "This session is not one you are teaching."
            : err.status === 404
              ? "Private session not found."
              : `HTTP ${err.status}`,
      );
    } finally {
      setLoading(false);
    }
  }, [api, id]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="mx-auto max-w-3xl">
      <Link
        href="/instructor/schedule"
        className="mb-2 inline-flex min-h-10 items-center gap-1 text-sm text-muted hover:text-ink sm:min-h-0"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> Back to my schedule
      </Link>

      {loading && !data ? (
        <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading private session…
        </div>
      ) : error || !data ? (
        <div className="mt-4 rounded-xl border border-error/30 bg-error/5 p-6 text-center text-sm text-error">
          {error ?? "Private session not found."}
        </div>
      ) : (
        <SessionPage data={data} onChanged={load} />
      )}
    </div>
  );
}

function SessionPage({ data, onChanged }: { data: InstructorPtDetail; onChanged: () => void | Promise<void> }) {
  const { api, may } = useWorkspace();
  // Cancelling a private session they run is Take PT bookings'.
  const canTakePt = may("take_pt_bookings");
  const [cancelBusy, setCancelBusy] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const state = computeEventState({ startsAt: data.starts_at, endsAt: data.ends_at, lifecycle: data.lifecycle });
  const where = [data.location?.name, data.room?.name].filter(Boolean).join(" · ");

  async function handleCancel() {
    if (!api || !data.pt_request_id || !confirm(ptCancelConfirm(data))) return;
    setCancelBusy(true);
    setCancelError(null);
    try {
      await cancelSession(api, "instructor", data.pt_request_id);
      await onChanged();
    } catch (e) {
      setCancelError(sessionActionErrorMessage(e, "Couldn't cancel the session"));
    } finally {
      setCancelBusy(false);
    }
  }

  return (
    <>
      <header className="mb-5 border-b border-border pb-5 sm:mb-6 sm:pb-6">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <Badge tone="accent">Private session</Badge>
          {isManual(data) && <Badge tone="neutral">Manual</Badge>}
          {state === "cancelled" && <Badge tone="error">Cancelled</Badge>}
          {state === "ongoing" && <Badge tone="warning">Ongoing</Badge>}
          {state === "completed" && <Badge tone="sage">Completed</Badge>}
          {state === "scheduled" && data.pt_request_id && canTakePt && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleCancel}
              disabled={cancelBusy}
              className="ml-auto text-error hover:text-error"
            >
              {cancelBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Ban className="h-4 w-4" />}
              Cancel session
            </Button>
          )}
        </div>
        <h1 className="break-words text-xl font-semibold text-ink sm:text-2xl">
          Private session · {sessionTypeLabel(data.session_type)}
        </h1>
        <p className="mt-1 text-sm text-muted">
          {[formatDate(data.starts_at), `${formatTime(data.starts_at)} – ${formatTime(data.ends_at)}`, where]
            .filter(Boolean)
            .join(" · ")}
        </p>
      </header>

      {cancelError && (
        <p role="alert" className="mb-4 rounded-md border border-error/30 bg-error/5 px-3 py-2 text-xs text-error">
          {cancelError}
        </p>
      )}

      <PtSessionMembers role="instructor" data={data} onChanged={onChanged} />
    </>
  );
}
