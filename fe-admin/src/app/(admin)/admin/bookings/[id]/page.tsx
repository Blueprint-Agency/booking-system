"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Check, Clock, X } from "lucide-react";
import { useAdminState } from "@/lib/admin-state";
import { formatDateTime, formatRelative } from "@/lib/formatters";
import {
  PageHeader,
  Badge,
  StatusBadge,
  Avatar,
  EmptyState,
  Button,
} from "@/components/ui";
import { CancelWithPolicyDialog } from "@/components/domain/bookings/cancel-with-policy-dialog";
import { AuditTimeline } from "@/components/audit/audit-timeline";
import { cn } from "@/lib/utils";

export default function BookingDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const booking = useAdminState((s) => s.bookings.find((b) => b.id === id));
  const session = useAdminState((s) =>
    booking ? s.sessions.find((ss) => ss.id === booking.sessionId) : undefined,
  );
  const client = useAdminState((s) =>
    booking ? s.clients.find((c) => c.id === booking.clientId) : undefined,
  );
  const instructor = useAdminState((s) =>
    session ? s.instructors.find((i) => i.id === session.instructorId) : undefined,
  );
  const location = useAdminState((s) =>
    session ? s.locations.find((l) => l.id === session.locationId) : undefined,
  );
  const pkg = useAdminState((s) =>
    booking?.packageId ? s.clientPackages.find((p) => p.id === booking.packageId) : undefined,
  );
  const [cancelOpen, setCancelOpen] = useState(false);

  if (!booking) {
    return (
      <EmptyState
        title="Booking not found"
        description="This booking doesn't exist or isn't in your tenant."
        cta={{ href: "/admin/bookings", label: "Back to bookings" }}
      />
    );
  }

  const startIso = session ? `${session.date}T${session.time}:00` : null;
  const isCancelled = booking.status === "cancelled";
  const isAttended = booking.checkInStatus === "attended" || booking.checkInStatus === "late";

  const timelineSteps = [
    {
      key: "created",
      label: "Created",
      ts: booking.createdAt,
      done: true,
      icon: Check,
    },
    {
      key: "confirmed",
      label: "Confirmed",
      ts: booking.createdAt,
      done: booking.status === "confirmed" || isAttended,
      icon: Check,
    },
    {
      key: "checkin",
      label: isCancelled
        ? "Cancelled"
        : isAttended
          ? "Attended"
          : booking.checkInStatus === "no-show"
            ? "No-show"
            : "Pending check-in",
      ts: booking.cancelledAt ?? booking.checkedInAt ?? null,
      done: isCancelled || isAttended || booking.checkInStatus === "no-show",
      icon: isCancelled ? X : isAttended ? Check : Clock,
    },
  ];

  return (
    <>
      <div className="flex items-center gap-2 text-sm text-muted mb-4">
        <button
          type="button"
          onClick={() => router.push("/admin/bookings")}
          className="inline-flex items-center gap-1 hover:text-ink"
        >
          <ArrowLeft className="h-4 w-4" /> Bookings
        </button>
      </div>
      <PageHeader
        title={`Booking ${booking.id}`}
        description={session ? `${session.name} · ${formatDateTime(`${session.date}T${session.time}:00`)}` : "Booking detail"}
        actions={
          <>
            <StatusBadge status={booking.status} />
            <Button
              variant="danger"
              disabled={isCancelled || !session}
              onClick={() => setCancelOpen(true)}
            >
              Cancel on behalf
            </Button>
          </>
        }
      />

      <div className="mt-6 grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="rounded-lg border border-border bg-card p-5">
          <h3 className="text-sm font-semibold text-ink mb-3">Client</h3>
          {client ? (
            <Link href={`/admin/clients/${client.id}`} className="flex items-center gap-3 hover:bg-paper rounded-md -m-1 p-1">
              <Avatar name={client.name} size={40} />
              <div>
                <div className="font-medium text-ink">{client.name}</div>
                <div className="text-xs text-muted">{client.email} · {client.phone}</div>
              </div>
            </Link>
          ) : (
            <p className="text-sm text-muted">Unknown client</p>
          )}
          {pkg && (
            <div className="mt-4 pt-4 border-t border-border">
              <div className="text-xs text-muted mb-1">Package used</div>
              <div className="text-sm">
                {pkg.sessionsRemaining}/{pkg.sessionsTotal} sessions remaining
              </div>
            </div>
          )}
        </div>

        <div className="rounded-lg border border-border bg-card p-5">
          <h3 className="text-sm font-semibold text-ink mb-3">Session</h3>
          {session ? (
            <div className="space-y-2">
              <div className="font-medium text-ink">{session.name}</div>
              <div className="text-sm text-muted">
                {startIso && formatDateTime(startIso)} · {session.duration} min
              </div>
              <div className="text-sm text-muted">
                {instructor?.name ?? "—"} · {location?.name ?? "—"}
              </div>
              <div className="flex gap-2 pt-2">
                <Badge tone="neutral">{session.bookedCount}/{session.capacity} booked</Badge>
                <Badge tone="neutral">{session.level}</Badge>
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted">Unknown session</p>
          )}
        </div>
      </div>

      <div className="mt-6 rounded-lg border border-border bg-card p-5">
        <h3 className="text-sm font-semibold text-ink mb-4">Timeline</h3>
        <ol className="space-y-3">
          {timelineSteps.map((step) => {
            const Icon = step.icon;
            return (
              <li key={step.key} className="flex items-start gap-3">
                <div
                  className={cn(
                    "flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full",
                    step.done ? "bg-sage/20 text-sage" : "bg-warm text-muted",
                  )}
                >
                  <Icon className="h-3.5 w-3.5" />
                </div>
                <div className="flex-1">
                  <div className="text-sm font-medium text-ink">{step.label}</div>
                  {step.ts && (
                    <div className="text-xs text-muted">
                      {formatDateTime(step.ts)} · {formatRelative(step.ts)}
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
        {booking.cancelReason && (
          <div className="mt-4 pt-4 border-t border-border">
            <div className="text-xs text-muted mb-1">Cancel reason</div>
            <div className="text-sm">{booking.cancelReason}</div>
            {booking.refunded !== undefined && (
              <div className="mt-1 text-xs text-muted">
                {booking.refunded ? "Refunded" : "Forfeited"}
              </div>
            )}
          </div>
        )}
      </div>
      <div className="mt-6 rounded-lg border border-border bg-card p-5">
        <h3 className="mb-3 text-sm font-semibold text-ink">Audit history</h3>
        <AuditTimeline targetId={booking.id} />
      </div>
      {session && (
        <CancelWithPolicyDialog
          booking={booking}
          session={session}
          open={cancelOpen}
          onOpenChange={setCancelOpen}
        />
      )}
    </>
  );
}
