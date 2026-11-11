"use client";
import { use, useCallback, useEffect, useState } from "react";
import { Ban } from "lucide-react";
import { Badge, Button } from "@/components/ui";
import { ClassRoster, SeatStats, Stat } from "@/components/schedule/class-roster";
import { WaitlistPanel } from "@/components/schedule/waitlist-panel";
import {
  DetailField,
  DetailFrame,
  DetailHeader,
  DetailSection,
  DifficultyBadge,
  ErrorDetail,
  LoadingDetail,
  type DetailBack,
} from "@/components/schedule/event-detail";
import { InstructorCancelClassDialog } from "@/components/schedule/instructor-cancel-class-dialog";
import { useWorkspace } from "@/lib/workspace-context";
import { permissionRefusal } from "@/lib/access-refusal";
import { ApiError } from "@/lib/api";
import { computeEventState } from "@/lib/event-state";
import { formatDate, formatTime } from "@/lib/formatters";
import { useStudioZone } from "@/components/brand/brand-provider";
import { fetchInstructorClass, type InstructorClassDetail } from "@/lib/schedule";
import { ruleSentence } from "@/lib/package-rule";

const BACK: DetailBack = { href: "/instructor/schedule", label: "Back to My schedule" };

/**
 * An instructor's own class (spec-waitlist.md §10), drawn as the Admin's class
 * page is: its details, the seats, the roster with each member's seat and
 * check-in, Add member into a free online seat, else a buffer seat (or the
 * waitlist), and the Waitlist panel. Without Manage rosters the roster and the
 * line stay; Add member, Cancel and the line's actions go. With Schedule
 * classes they may cancel the class. No pay and no editing — those are the
 * admin's.
 */
export default function InstructorClassPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { api } = useWorkspace();
  const [data, setData] = useState<InstructorClassDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!api) return;
    setLoading(true);
    setError(null);
    try {
      setData(await fetchInstructorClass(api, id));
    } catch (err) {
      setError(
        // A switch's refusal is a 403 too, so it is named before ownership is.
        permissionRefusal(err) ??
        (!(err instanceof ApiError)
          ? "Network error"
          : err.status === 403
            ? "This class is not one you are teaching."
            : err.status === 404
              ? "Class not found."
              : `HTTP ${err.status}`),
      );
    } finally {
      setLoading(false);
    }
  }, [api, id]);

  useEffect(() => {
    void load();
  }, [load]);

  // Only the first read shows the spinner; a re-read after an action keeps the page.
  if (loading && !data) return <LoadingDetail back={BACK} label="class" />;
  if (error || !data) return <ErrorDetail back={BACK} kind="Class" message={error ?? "Class not found."} />;
  return <ClassPage data={data} onChanged={load} />;
}

function ClassPage({ data, onChanged }: { data: InstructorClassDetail; onChanged: () => void | Promise<void> }) {
  const { may } = useWorkspace();
  const timezone = useStudioZone();
  // Add member (and its waitlist offer), Cancel and the Waitlist actions are
  // Manage rosters; the roster and the line are not.
  const managesRosters = may("manage_rosters");
  // Cancelling the class is Schedule classes'.
  const canSchedule = may("schedule_classes");
  const [cancelOpen, setCancelOpen] = useState(false);
  const state = computeEventState({
    startsAt: data.starts_at,
    endsAt: data.ends_at,
    lifecycle: data.lifecycle,
  });
  const title = data.class_type?.name ?? "Class";
  const time = `${formatTime(timezone, data.starts_at)} – ${formatTime(timezone, data.ends_at)}`;
  const canCancel = canSchedule && data.lifecycle === "active" && state !== "completed";

  return (
    <DetailFrame back={BACK}>
      <DetailHeader
        badge={<Badge tone="cyan">Class</Badge>}
        state={state}
        title={title}
        meta={[formatDate(timezone, data.starts_at), time]}
        action={
          canCancel ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setCancelOpen(true)}
              className="text-error hover:text-error"
            >
              <Ban className="h-4 w-4" />
              Cancel class
            </Button>
          ) : undefined
        }
      />

      <InstructorCancelClassDialog
        target={
          cancelOpen
            ? { id: data.id, label: title, startsAt: data.starts_at, bookedCount: data.attendees.length }
            : null
        }
        onClose={() => setCancelOpen(false)}
        onCancelled={async () => {
          setCancelOpen(false);
          await onChanged();
        }}
      />

      <DetailSection>
        <DetailField label="Date" value={formatDate(timezone, data.starts_at)} />
        <DetailField label="Time" value={time} />
        <DetailField label="Location" value={data.location?.name ?? "—"} />
        <DetailField label="Room" value={data.room?.name ?? "—"} />
        <DetailField label="Difficulty">
          <DifficultyBadge difficulty={data.difficulty} />
        </DetailField>
        <DetailField label="Accepts" value={ruleSentence(data.package_rule)} />
      </DetailSection>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <SeatStats seats={data} />
        <Stat
          label="Credit cost"
          value={`${data.credit_cost} credit${data.credit_cost === 1 ? "" : "s"}`}
        />
      </div>

      <ClassRoster
        role="instructor"
        classId={data.id}
        attendees={data.attendees}
        cancelledBookings={data.cancelled_bookings}
        cancelled={data.lifecycle === "cancelled"}
        canAdd={managesRosters && state === "scheduled"}
        canCancel={managesRosters}
        onChanged={onChanged}
      />
      <WaitlistPanel
        role="instructor"
        classId={data.id}
        data={data}
        canAct={managesRosters && state === "scheduled"}
        onChanged={onChanged}
      />
    </DetailFrame>
  );
}
