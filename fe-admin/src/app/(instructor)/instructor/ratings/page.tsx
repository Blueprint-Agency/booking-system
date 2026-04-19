"use client";

import { useMemo } from "react";
import { Star } from "lucide-react";
import { useAdminState } from "@/lib/admin-state";
import { useMyInstructorId } from "@/lib/instructor-scope";
import { PageHeader, EmptyState } from "@/components/ui";

export default function RatingsPage() {
  const myId = useMyInstructorId();
  const bookings = useAdminState((s) => s.bookings);
  const sessions = useAdminState((s) => s.sessions);

  const myRatings = useMemo(() => {
    if (!myId) return [] as { rating: number; sessionName: string }[];
    const mySessionIds = new Set(sessions.filter((s) => s.instructorId === myId).map((s) => s.id));
    return bookings
      .filter((b) => mySessionIds.has(b.sessionId) && b.rating !== null)
      .map((b) => ({
        rating: b.rating as number,
        sessionName: sessions.find((s) => s.id === b.sessionId)?.name ?? "—",
      }));
  }, [myId, sessions, bookings]);

  const avg = myRatings.length === 0 ? 0 : myRatings.reduce((s, r) => s + r.rating, 0) / myRatings.length;

  if (!myId) return null;

  return (
    <>
      <PageHeader title="Ratings" description="Anonymous post-class feedback from clients." />
      {myRatings.length === 0 ? (
        <div className="mt-6">
          <EmptyState
            title="No ratings yet"
            description="Once clients rate your classes, the average and recent comments will show here."
          />
        </div>
      ) : (
        <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div className="rounded-lg border border-border bg-card p-4">
            <div className="text-xs uppercase tracking-wider text-muted">Average</div>
            <div className="mt-1 flex items-center gap-1 text-3xl font-semibold text-ink">
              {avg.toFixed(1)}
              <Star className="h-5 w-5 fill-accent text-accent" />
            </div>
            <div className="mt-1 text-xs text-muted">across {myRatings.length} sessions</div>
          </div>
        </div>
      )}
    </>
  );
}
