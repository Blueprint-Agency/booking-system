"use client";

import { useMemo } from "react";
import type { Client, Instructor, PrivateRequest } from "@/types";
import { RequestSummary } from "./request-summary";
import { slaTier } from "@/lib/sla";

export function RequestInbox({
  requests,
  clients,
  instructors,
  now,
}: {
  requests: PrivateRequest[];
  clients: Client[];
  instructors: Instructor[];
  now: Date;
}) {
  const { pending, approved, declined } = useMemo(() => {
    const sortPending = (a: PrivateRequest, b: PrivateRequest) =>
      new Date(a.deadlineAt).getTime() - new Date(b.deadlineAt).getTime();
    const pending = requests.filter((r) => r.status === "pending").sort(sortPending);
    const approved = requests.filter((r) => r.status === "approved");
    const declined = requests.filter((r) => r.status === "declined");
    return { pending, approved, declined };
  }, [requests]);

  const nowMs = now.getTime();
  const tierCounts = pending.reduce(
    (acc, r) => {
      const t = slaTier(r.deadlineAt, nowMs);
      acc[t] = (acc[t] ?? 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );

  return (
    <div className="space-y-6">
      <section>
        <div className="mb-2 flex items-baseline justify-between">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-ink/70">
            Pending · {pending.length}
          </h3>
          <div className="flex gap-3 text-[11px] text-ink/50">
            {tierCounts.overdue ? <span>overdue: {tierCounts.overdue}</span> : null}
            {tierCounts.red ? <span>&lt;2h: {tierCounts.red}</span> : null}
            {tierCounts.amber ? <span>2–6h: {tierCounts.amber}</span> : null}
            {tierCounts.green ? <span>&gt;6h: {tierCounts.green}</span> : null}
          </div>
        </div>
        {pending.length === 0 ? (
          <div className="rounded-xl border border-dashed border-ink/15 p-6 text-center text-sm text-ink/50">
            Inbox zero.
          </div>
        ) : (
          <div className="space-y-2">
            {pending.map((r) => (
              <RequestSummary key={r.id} request={r} clients={clients} instructors={instructors} now={now} />
            ))}
          </div>
        )}
      </section>

      {approved.length > 0 && (
        <section>
          <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-ink/70">
            Approved · {approved.length}
          </h3>
          <div className="space-y-2">
            {approved.map((r) => (
              <RequestSummary key={r.id} request={r} clients={clients} instructors={instructors} now={now} />
            ))}
          </div>
        </section>
      )}
      {declined.length > 0 && (
        <section>
          <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-ink/70">
            Declined · {declined.length}
          </h3>
          <div className="space-y-2">
            {declined.map((r) => (
              <RequestSummary key={r.id} request={r} clients={clients} instructors={instructors} now={now} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
