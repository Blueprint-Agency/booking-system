import { LEAVE_TYPE_LABEL, type ApiLeaveBalance } from "@/lib/leave";

/** One Leave Type's year on a "My leave" page: what is left, out of what, and
 *  where it went. */
export function BalanceCard({ balance }: { balance: ApiLeaveBalance }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-soft">
      <div className="text-xs text-muted">{LEAVE_TYPE_LABEL[balance.type]} leave</div>
      <div className="mt-1 flex items-baseline gap-1.5">
        <span className="text-2xl font-semibold tabular-nums text-ink">
          {balance.remaining_days}
        </span>
        <span className="text-sm text-muted">of {balance.pool_days} days left</span>
      </div>
      <p className="mt-1 text-xs text-muted">
        {balance.taken_days} approved
        {balance.pending_days > 0 && `, ${balance.pending_days} awaiting a decision`}
      </p>
      {/* Named only when there is some: a staff member should be able to tell a
          one-off surplus from their yearly assigned days. Medical never carries. */}
      {balance.carried_days > 0 && (
        <p className="mt-0.5 text-xs text-muted">
          {balance.assigned_days} assigned, plus {balance.carried_days}{" "}
          {balance.carried_days === 1 ? "day" : "days"} carried over from last year.
        </p>
      )}
    </div>
  );
}
