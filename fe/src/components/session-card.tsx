"use client";

import Link from "next/link";
import { cn, formatDate, formatTime, formatCurrency } from "@/lib/utils";
import { StatusBadge, StatusDot } from "@/components/status-badge";
import { CapacityBar } from "@/components/capacity-bar";
import type { Session, Instructor } from "@/types";

export function SessionCard({
  session,
  instructor,
  hasPackage = false,
  className,
  style,
}: {
  session: Session;
  instructor?: Instructor;
  hasPackage?: boolean;
  className?: string;
  style?: React.CSSProperties;
}) {
  const isCancelled = session.status === "cancelled";

  return (
    <Link
      href={`/sessions/${session.id}`}
      className={cn(
        "block bg-card border border-border rounded-lg p-6 transition-all duration-300",
        "hover:shadow-hover hover:-translate-y-0.5 hover:border-accent",
        isCancelled && "opacity-60",
        className
      )}
      style={style}
    >
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-center gap-2 flex-wrap">
          <StatusBadge status={session.category} />
          <StatusBadge status={session.level} />
          {session.type !== "regular" && <StatusBadge status={session.type} />}
        </div>
        <div className="flex items-center gap-1.5">
          <StatusDot
            status={
              session.bookedCount >= session.capacity
                ? session.waitlistEnabled
                  ? "waitlist"
                  : "full"
                : "open"
            }
          />
          <span className="text-xs text-muted">
            {session.bookedCount >= session.capacity
              ? session.waitlistEnabled
                ? "Waitlist"
                : "Full"
              : "Open"}
          </span>
        </div>
      </div>

      <h3
        className={cn(
          "font-serif text-lg mb-2",
          isCancelled && "line-through"
        )}
      >
        {session.name}
      </h3>

      <p className="text-sm text-muted mb-1">
        {formatDate(session.date)} &middot; {formatTime(session.time)} &middot;{" "}
        {session.duration} min
      </p>

      {instructor && (
        <p className="text-sm text-muted mb-3">{instructor.name}</p>
      )}

      <div className="flex items-center justify-between mt-auto pt-3 border-t border-border">
        <CapacityBar
          booked={session.bookedCount}
          capacity={session.capacity}
          className="flex-1 mr-4"
        />
        <span className="text-sm font-medium whitespace-nowrap">
          {hasPackage && session.packageEligible ? (
            <span className="text-sage">Pkg ✓</span>
          ) : (
            <span className="text-ink">{formatCurrency(session.price)}</span>
          )}
        </span>
      </div>
    </Link>
  );
}
