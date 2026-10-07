"use client";

/**
 * A member's class bookings, as `GET /me/bookings/upcoming`, `/past` and `/cancelled` return
 * them (be-client.md §3/§4c), and their places in line (`GET /me/waitlist`,
 * spec-waitlist.md §9). The list itself is "Your bookings" (`/account`).
 */
import { Hourglass, MapPin, UserRound, X } from "lucide-react";
import { formatDate, cn } from "@/lib/utils";
import { formatClassTime } from "@/lib/classes";
import { BTN_CANCEL } from "@/components/ui/styles";
import type { ApiWaitlistEntry } from "@/lib/waitlist";
import type { CancelledBy } from "@/lib/cancellation-copy";

export interface ApiBooking {
  booking_id: string;
  class_id: string;
  name: string;
  instructor: { id: string; name: string } | null;
  location: { id: string; name: string } | null;
  room: { id: string; name: string } | null;
  starts_at: string;
  ends_at: string;
  credit_cost: number;
  credits_used: number;
  package_kind: string | null;
  was_unlimited: boolean;
  check_in_state: "pending" | "attended" | "no_show" | "n_a";
  state: "confirmed" | "cancelled" | "no_show";
  qr_token: string;
  code: string;
  /** This class's Cancellation Window in hours, as the server applies it now. */
  effective_cancel_window_hours: number;
  /** When that window opens: a cancel after it is a late cancellation. */
  cancel_deadline: string;
  /**
   * Only on `GET /me/bookings/cancelled`: the cancellation's summary (#349) —
   * when, who, and its two lines as the server words them.
   */
  cancelled_at?: string | null;
  cancelled_by?: CancelledBy;
  who_line?: string;
  outcome_line?: string;
}

/** A place in line for a full class, with the way out of it. */
export function WaitlistCard({
  entry,
  onLeave,
}: {
  entry: ApiWaitlistEntry;
  onLeave: (e: ApiWaitlistEntry) => void;
}) {
  return (
    <div className="rounded-2xl border border-warning/40 bg-warning/[0.06] p-4">
      <div className="flex items-start justify-between gap-3 sm:gap-4">
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-ink break-words">{entry.name}</p>
          <p className="mt-0.5 text-sm font-medium text-ink/80">
            {formatDate(entry.starts_at)} · {formatClassTime(entry.starts_at)}
          </p>
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {[
              { icon: UserRound, label: entry.instructor },
              { icon: MapPin, label: entry.location },
            ].map((c) => (
              <li
                key={c.label}
                className="inline-flex max-w-full items-center gap-1 rounded-full border border-ink/10 bg-card px-2 py-0.5 text-xs font-medium text-ink"
              >
                <c.icon className="h-3 w-3 shrink-0 text-ink/40" aria-hidden />
                <span className="truncate">{c.label}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
      <div className="mt-3 flex items-center justify-between gap-3">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-warning/15 px-2.5 py-1 text-xs font-semibold text-ink">
          <Hourglass className="h-3.5 w-3.5 text-ink/50" aria-hidden />
          #{entry.position} in line
        </span>
        <button type="button" onClick={() => onLeave(entry)} className={cn(BTN_CANCEL, "-mr-1")}>
          <X className="h-4 w-4" aria-hidden />
          Leave waitlist
        </button>
      </div>
    </div>
  );
}
