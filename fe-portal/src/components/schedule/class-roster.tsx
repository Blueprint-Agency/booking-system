"use client";
// The class session page's roster, shared by the admin and instructor portals
// (spec-waitlist.md §10): seat stats, the booked members each tagged with the
// seat they hold, the attendance tick, and Add member. Everything that differs
// between the two roles is the `role` prop — which routes it calls, whether a
// member's name links to their profile, and whether a full class may be
// overbooked.

import { useEffect, useState } from "react";
import Link from "next/link";
import { Check, Loader2, Plus, Search, X } from "lucide-react";
import { Badge, Button, Input } from "@/components/ui";
import { useWorkspace } from "@/lib/workspace-context";
import { checkInErrorMessage } from "@/lib/check-in";
import {
  searchMembers,
  seatTag,
  seatsSummary,
  staffBookClass,
  type ClassSeats,
  type MemberMatch,
  type StaffRole,
} from "@/lib/class-seats";
import {
  staffBookingPrompt,
  staffJoinRefusal,
  staffJoinWaitlist,
  waitlistStat,
  type ClassWaitlist,
  type StaffBookingPrompt,
} from "@/lib/class-waitlist";
import type { ScheduleClassAttendee } from "@/lib/schedule";

export function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-soft">
      <div className="text-xs font-medium uppercase tracking-wide text-muted">{label}</div>
      <div className="mt-1 text-lg font-semibold tabular-nums text-ink">{value}</div>
      {sub && <div className="text-xs text-muted">{sub}</div>}
    </div>
  );
}

/** "Booked 8 / 16", the seats by kind, and "Waitlist 3 / 5". */
export function SeatStats({ seats }: { seats: ClassSeats & Pick<ClassWaitlist, "waiting" | "capacity_waitlist"> }) {
  const s = seatsSummary(seats);
  return (
    <>
      <Stat label="Booked" value={s.booked} sub="attendance capacity" />
      <Stat label="Seats" value={s.seats} sub={s.overbooked ?? undefined} />
      <Stat label="Waitlist" value={waitlistStat(seats)} sub="waiting" />
    </>
  );
}

const PACKAGE_KIND_LABEL: Record<NonNullable<ScheduleClassAttendee["package_kind"]>, string> = {
  credit_bundle: "Credit bundle",
  unlimited: "Unlimited",
  trial: "Trial pass",
  pt: "PT",
};

export function ClassRoster({
  role,
  classId,
  attendees,
  cancelled,
  canAdd,
  onChanged,
}: {
  role: StaffRole;
  classId: string;
  attendees: ScheduleClassAttendee[];
  cancelled: boolean;
  /** Add member is offered only while the class can still be booked. */
  canAdd: boolean;
  /** A member was added: reload the class so the stats and roster agree. */
  onChanged: () => void;
}) {
  const { api } = useWorkspace();
  const [rows, setRows] = useState<ScheduleClassAttendee[]>(attendees);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // Re-sync when the parent reloads the class.
  useEffect(() => setRows(attendees), [attendees]);

  // When the tick opens is the studio's Check-in Window, which the server
  // holds; a tick before it comes back refused with the opening time.
  const attendedCount = rows.filter((r) => r.check_in_state === "attended").length;

  async function toggle(a: ScheduleClassAttendee) {
    if (!api || cancelled || busyId) return;
    const attended = a.check_in_state !== "attended";
    setBusyId(a.booking_id);
    setErr(null);
    try {
      const res = await api.post<{ check_in_state: ScheduleClassAttendee["check_in_state"] }>(
        `/portal/${role}/check-in/manual`,
        { booking_id: a.booking_id, attended },
      );
      setRows((prev) =>
        prev.map((r) =>
          r.booking_id === a.booking_id ? { ...r, check_in_state: res.check_in_state } : r,
        ),
      );
    } catch (e) {
      // The backend words its own refusal (the Check-in Window, a cancelled
      // booking) — show that rather than guessing from the status.
      setErr(checkInErrorMessage(e, "Couldn't update attendance"));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="mt-6 rounded-xl border border-border bg-card p-5 shadow-soft">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-ink">Booked customers ({rows.length})</h2>
        {rows.length > 0 && (
          <span className="text-xs text-muted">{attendedCount} checked in</span>
        )}
      </div>
      {canAdd && <AddMember role={role} classId={classId} onBooked={onChanged} />}
      {err && (
        <p className="mb-3 rounded-md border border-error/30 bg-error/5 px-3 py-2 text-xs text-error">
          {err}
        </p>
      )}
      {rows.length === 0 ? (
        <p className="text-sm text-muted">No bookings yet.</p>
      ) : (
        <ul className="divide-y divide-border">
          {rows.map((a) => {
            const attended = a.check_in_state === "attended";
            const noShow = a.check_in_state === "no_show";
            const disabled = cancelled || busyId === a.booking_id;
            const tag = seatTag(a.seat);
            return (
              <li
                key={a.booking_id}
                className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 py-2.5 text-sm"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    {role === "admin" ? (
                      <Link
                        href={`/admin/customers/${a.client.id}`}
                        className="text-ink hover:text-accent"
                      >
                        {a.client.name}
                      </Link>
                    ) : (
                      <span className="text-ink">{a.client.name}</span>
                    )}
                    {tag && (
                      <Badge tone={a.seat === "overbook" ? "warning" : "neutral"}>{tag}</Badge>
                    )}
                  </div>
                  <div className="text-xs text-muted">
                    {a.package_kind ? PACKAGE_KIND_LABEL[a.package_kind] : "—"} · {a.code}
                    {a.promoted_from_waitlist && " · Promoted from waitlist"}
                  </div>
                </div>
                <div className="ml-auto flex shrink-0 items-center gap-2">
                  {noShow && !attended && <Badge tone="error">No-show</Badge>}
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={attended}
                    aria-label={attended ? "Mark as not attended" : "Mark as attended"}
                    disabled={disabled}
                    onClick={() => toggle(a)}
                    className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                      attended
                        ? "border-sage/40 bg-sage/15 text-sage"
                        : "border-border bg-card text-muted hover:border-accent/40 hover:text-ink"
                    }`}
                  >
                    {busyId === a.booking_id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <span
                        className={`flex h-4 w-4 items-center justify-center rounded border ${
                          attended ? "border-sage bg-sage text-white" : "border-muted"
                        }`}
                      >
                        {attended && <Check className="h-3 w-3" />}
                      </span>
                    )}
                    {attended ? "Attended" : "Mark attended"}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/**
 * Find a member and book them on. Staff take a buffer seat; when there is none
 * the refusal becomes a question — "Overbook, or add to the waitlist?" for an
 * admin, "Add to the waitlist?" for an instructor, without the waitlist when
 * the class's line is closed.
 */
function AddMember({
  role,
  classId,
  onBooked,
}: {
  role: StaffRole;
  classId: string;
  onBooked: () => void;
}) {
  const { api } = useWorkspace();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [matches, setMatches] = useState<MemberMatch[]>([]);
  const [searching, setSearching] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  /** The member a refusal is about, and what it said. */
  const [refusal, setRefusal] = useState<{ member: MemberMatch; refusal: StaffBookingPrompt } | null>(null);
  const [added, setAdded] = useState<string | null>(null);

  useEffect(() => {
    if (!api || !open) return;
    const term = q.trim();
    if (term.length < 2) return;
    let live = true;
    const t = setTimeout(async () => {
      setSearching(true);
      try {
        const rows = await searchMembers(api, role, term);
        if (live) setMatches(rows);
      } catch {
        if (live) setMatches([]);
      } finally {
        if (live) setSearching(false);
      }
    }, 250);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [api, open, q, role]);

  function close() {
    setOpen(false);
    setQ("");
    setMatches([]);
    setRefusal(null);
  }

  async function book(member: MemberMatch, overbook = false) {
    if (!api || busyId) return;
    setBusyId(member.id);
    setRefusal(null);
    setAdded(null);
    try {
      const res = await staffBookClass(api, role, classId, member.id, overbook);
      setAdded(
        res.seat === "overbook"
          ? `${member.name} was added as an overbooking.`
          : `${member.name} was added to a buffer seat.`,
      );
      close();
      onBooked();
    } catch (e) {
      setRefusal({ member, refusal: staffBookingPrompt(e, role) });
    } finally {
      setBusyId(null);
    }
  }

  async function waitlist(member: MemberMatch) {
    if (!api || busyId) return;
    setBusyId(member.id);
    setRefusal(null);
    setAdded(null);
    try {
      const res = await staffJoinWaitlist(api, role, classId, member.id);
      setAdded(`${member.name} is #${res.position} on the waitlist.`);
      close();
      onBooked();
    } catch (e) {
      setRefusal({ member, refusal: { kind: "error", message: staffJoinRefusal(e) } });
    } finally {
      setBusyId(null);
    }
  }

  // A term too short to search shows nothing, whatever the last search found.
  const searchable = q.trim().length >= 2;
  const shown = searchable ? matches : [];

  if (!open) {
    return (
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <Button type="button" variant="secondary" size="sm" onClick={() => setOpen(true)}>
          <Plus className="h-4 w-4" /> Add member
        </Button>
        {added && <span className="text-xs text-sage">{added}</span>}
      </div>
    );
  }

  return (
    <div className="mb-4 rounded-lg border border-border bg-paper p-3">
      <div className="flex items-center gap-2">
        <Search className="h-4 w-4 shrink-0 text-muted" />
        <Input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search members by name, email or phone"
          aria-label="Search members"
        />
        <Button type="button" variant="ghost" size="sm" onClick={close} aria-label="Close">
          <X className="h-4 w-4" />
        </Button>
      </div>

      {refusal && refusal.refusal.kind === "full" && (
        <div
          role="alertdialog"
          aria-label="No seats left"
          className="mt-3 flex flex-wrap items-center gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-ink"
        >
          <span className="flex-1">{refusal.refusal.message}</span>
          {refusal.refusal.canOverbook || refusal.refusal.canWaitlist ? (
            <>
              {refusal.refusal.canOverbook && (
                <Button
                  type="button"
                  size="sm"
                  disabled={busyId !== null}
                  onClick={() => book(refusal.member, true)}
                >
                  Overbook
                </Button>
              )}
              {refusal.refusal.canWaitlist && (
                <Button
                  type="button"
                  size="sm"
                  variant={refusal.refusal.canOverbook ? "secondary" : "primary"}
                  disabled={busyId !== null}
                  onClick={() => waitlist(refusal.member)}
                >
                  Add to waitlist
                </Button>
              )}
              {busyId === refusal.member.id && <Loader2 className="h-4 w-4 animate-spin" />}
              <Button type="button" variant="ghost" size="sm" onClick={() => setRefusal(null)}>
                Cancel
              </Button>
            </>
          ) : (
            <Button type="button" variant="ghost" size="sm" onClick={() => setRefusal(null)}>
              OK
            </Button>
          )}
        </div>
      )}
      {refusal && refusal.refusal.kind === "error" && (
        <p className="mt-3 rounded-md border border-error/30 bg-error/5 px-3 py-2 text-xs text-error">
          {refusal.refusal.message}
        </p>
      )}

      <ul className="mt-2 divide-y divide-border">
        {searching && shown.length === 0 && (
          <li className="py-2 text-xs text-muted">Searching…</li>
        )}
        {!searching && searchable && shown.length === 0 && (
          <li className="py-2 text-xs text-muted">No members match.</li>
        )}
        {shown.map((m) => (
          <li key={m.id} className="flex items-center justify-between gap-3 py-2 text-sm">
            <div className="min-w-0">
              <div className="truncate text-ink">{m.name}</div>
              <div className="truncate text-xs text-muted">{m.email}</div>
            </div>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={busyId !== null}
              onClick={() => book(m)}
            >
              {busyId === m.id ? <Loader2 className="h-4 w-4 animate-spin" /> : "Add"}
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}
