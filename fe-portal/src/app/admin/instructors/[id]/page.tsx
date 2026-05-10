import { notFound } from "next/navigation";
import { instructors, classInstances, ratings } from "@/data";
import { InstructorForm } from "@/components/instructors/instructor-form";
import { computeEventState } from "@/lib/event-state";

export default async function InstructorDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const instructor = instructors.find((i) => i.id === id);
  if (!instructor) notFound();

  // Aggregate rating for §14 surfacing on instructor profile
  const myRatings = ratings.filter((r) => r.instructorId === instructor.id);
  const avgStars =
    myRatings.length > 0
      ? myRatings.reduce((s, r) => s + r.stars, 0) / myRatings.length
      : null;

  const upcoming = classInstances.filter(
    (c) =>
      c.instructorId === instructor.id &&
      computeEventState({
        startsAt: c.startsAt,
        endsAt: c.endsAt,
        lifecycle: c.lifecycle,
      }) === "scheduled"
  ).length;

  return (
    <div className="mx-auto max-w-3xl">
      <InstructorForm initial={instructor} />
      <div className="mt-6 grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-border bg-card p-4 shadow-soft">
          <div className="text-xs font-medium uppercase tracking-wide text-muted">
            Avg rating
          </div>
          <div className="mt-1 font-mono text-lg font-semibold text-ink">
            {avgStars ? `${avgStars.toFixed(1)} / 5` : "—"}
          </div>
          <div className="text-xs text-muted">
            {myRatings.length} rating{myRatings.length === 1 ? "" : "s"}
          </div>
        </div>
        <div className="rounded-xl border border-border bg-card p-4 shadow-soft">
          <div className="text-xs font-medium uppercase tracking-wide text-muted">
            Upcoming classes
          </div>
          <div className="mt-1 font-mono text-lg font-semibold text-ink">{upcoming}</div>
        </div>
        <div className="rounded-xl border border-border bg-card p-4 shadow-soft">
          <div className="text-xs font-medium uppercase tracking-wide text-muted">
            Total taught
          </div>
          <div className="mt-1 font-mono text-lg font-semibold text-ink">—</div>
          <div className="text-xs text-muted">Surfaces with reports (next phase)</div>
        </div>
      </div>
    </div>
  );
}
