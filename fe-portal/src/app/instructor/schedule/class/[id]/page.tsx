"use client";
import { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui";
import { ClassRoster, SeatStats, Stat } from "@/components/schedule/class-roster";
import { WaitlistPanel } from "@/components/schedule/waitlist-panel";
import { useWorkspace } from "@/lib/workspace-context";
import { ApiError } from "@/lib/api";
import { computeEventState } from "@/lib/event-state";
import { formatDate, formatTime } from "@/lib/formatters";
import { fetchInstructorClass, type InstructorClassDetail } from "@/lib/schedule";

/**
 * An instructor's own class (spec-waitlist.md §10): the seats, the roster with
 * each member's seat, the attendance tick, Add member into a buffer seat (or
 * the waitlist), and the Waitlist panel.
 * No pay and no editing — those are the admin's page.
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
        !(err instanceof ApiError)
          ? "Network error"
          : err.status === 403
            ? "This class is not one you are teaching."
            : err.status === 404
              ? "Class not found."
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
        className="mb-2 inline-flex items-center gap-1 text-sm text-muted hover:text-ink"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> Back to my schedule
      </Link>

      {loading && !data ? (
        <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading class…
        </div>
      ) : error || !data ? (
        <div className="mt-4 rounded-xl border border-error/30 bg-error/5 p-6 text-center text-sm text-error">
          {error ?? "Class not found."}
        </div>
      ) : (
        <ClassPage data={data} onChanged={load} />
      )}
    </div>
  );
}

function ClassPage({ data, onChanged }: { data: InstructorClassDetail; onChanged: () => void }) {
  const state = computeEventState({
    startsAt: data.starts_at,
    endsAt: data.ends_at,
    lifecycle: data.lifecycle,
  });
  const where = [data.location?.name, data.room?.name].filter(Boolean).join(" · ");

  return (
    <>
      <header className="mb-6 border-b border-border pb-6">
        <div className="mb-2 flex items-center gap-2">
          <Badge tone="cyan">Class</Badge>
          {state === "cancelled" && <Badge tone="error">Cancelled</Badge>}
          {state === "ongoing" && <Badge tone="warning">Ongoing</Badge>}
          {state === "completed" && <Badge tone="sage">Completed</Badge>}
        </div>
        <h1 className="text-2xl font-semibold text-ink">{data.class_type?.name ?? "Class"}</h1>
        <p className="mt-1 text-sm text-muted">
          {[formatDate(data.starts_at), `${formatTime(data.starts_at)} – ${formatTime(data.ends_at)}`, where]
            .filter(Boolean)
            .join(" · ")}
        </p>
      </header>

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
        cancelled={data.lifecycle === "cancelled"}
        canAdd={state === "scheduled"}
        onChanged={onChanged}
      />
      <WaitlistPanel
        role="instructor"
        classId={data.id}
        data={data}
        canAct={state === "scheduled"}
        onChanged={onChanged}
      />
    </>
  );
}
