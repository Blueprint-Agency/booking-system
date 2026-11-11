"use client";
import { use, useCallback, useEffect, useState } from "react";
import { Ban } from "lucide-react";
import { Badge, Button } from "@/components/ui";
import { PtSessionMembers } from "@/components/schedule/pt-session-members";
import { CancelPtDialog } from "@/components/pt-requests/cancel-pt-dialog";
import {
  DetailField,
  DetailFrame,
  DetailHeader,
  DetailSection,
  ErrorDetail,
  LoadingDetail,
  type DetailBack,
} from "@/components/schedule/event-detail";
import { useWorkspace } from "@/lib/workspace-context";
import { ApiError } from "@/lib/api";
import { computeEventState } from "@/lib/event-state";
import { formatDate, formatTime } from "@/lib/formatters";
import { useStudioZone } from "@/components/brand/brand-provider";
import { fetchInstructorPt, type InstructorPtDetail } from "@/lib/schedule";
import {
  canCancelSession,
  cancelSession,
  isManual,
  ptCancelConfirm,
  sessionActionErrorMessage,
  sessionTypeLabel,
} from "@/lib/pt-manual";

const BACK: DetailBack = { href: "/instructor/schedule", label: "Back to My schedule" };

/**
 * A private session the instructor runs, drawn as the Admin's session page is:
 * its details, who is on it and the package paying each seat, with the
 * Admin's member actions on a manual one — remove a member, fill a free seat —
 * and cancelling it. No pay, no editing and no type change: those are the
 * admin's.
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

  // Only the first read shows the spinner; a re-read after an action keeps the page.
  if (loading && !data) return <LoadingDetail back={BACK} label="private session" />;
  if (error || !data)
    return <ErrorDetail back={BACK} kind="Private session" message={error ?? "Private session not found."} />;
  return <SessionPage data={data} onChanged={load} />;
}

function SessionPage({ data, onChanged }: { data: InstructorPtDetail; onChanged: () => void | Promise<void> }) {
  const { api, may } = useWorkspace();
  const timezone = useStudioZone();
  // Cancelling a private session they run is Take PT bookings'.
  const canTakePt = may("take_pt_bookings");
  const [cancelOpen, setCancelOpen] = useState(false);
  const state = computeEventState({ startsAt: data.starts_at, endsAt: data.ends_at, lifecycle: data.lifecycle });
  const typeLabel = sessionTypeLabel(data.session_type);
  const time = `${formatTime(timezone, data.starts_at)} – ${formatTime(timezone, data.ends_at)}`;
  const meta = [
    formatDate(timezone, data.starts_at),
    time,
    data.instructor?.name,
    data.location?.name,
    data.room?.name,
  ].filter((x): x is string => Boolean(x));

  async function cancelWithNote(note: string | null) {
    if (!api || !data.pt_request_id) return;
    await cancelSession(api, "instructor", data.pt_request_id, note);
    await onChanged();
  }

  return (
    <DetailFrame back={BACK}>
      <DetailHeader
        badge={
          <>
            <Badge tone="accent">Private session</Badge>
            {isManual(data) && <Badge tone="neutral">Manual</Badge>}
          </>
        }
        state={state}
        title={`Private session · ${typeLabel}`}
        meta={meta}
        action={
          canCancelSession(data) && data.pt_request_id && canTakePt ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setCancelOpen(true)}
              className="text-error hover:text-error"
            >
              <Ban className="h-4 w-4" />
              Cancel session
            </Button>
          ) : undefined
        }
      />

      <CancelPtDialog
        open={cancelOpen}
        onOpenChange={setCancelOpen}
        title="Cancel session"
        consequence={ptCancelConfirm(data)}
        onConfirm={cancelWithNote}
        errorMessage={(e) => sessionActionErrorMessage(e, "Couldn't cancel the session", timezone)}
      />

      <DetailSection>
        <DetailField label="Date" value={formatDate(timezone, data.starts_at)} />
        <DetailField label="Time" value={time} />
        <DetailField label="Format" value={typeLabel} />
        <DetailField label="Instructor" value={data.instructor?.name ?? "—"} />
        <DetailField label="Location" value={data.location?.name ?? "—"} />
        <DetailField label="Room" value={data.room?.name ?? "—"} />
      </DetailSection>

      <PtSessionMembers role="instructor" data={data} onChanged={onChanged} />
    </DetailFrame>
  );
}
