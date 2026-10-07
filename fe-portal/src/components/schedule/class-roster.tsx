"use client";
// The class session page's roster, shared by the admin and instructor portals
// (spec-waitlist.md §10): seat stats, the booked members each tagged with the
// seat they hold, whether each is checked in (marking it is the check-in
// desk's alone), Cancel, and Add member. Everything that differs
// between the two roles is the `role` prop — which routes it calls, whether a
// member's name links to their profile, and whether a full class may be
// overbooked.

import { useEffect, useState } from "react";
import Link from "next/link";
import { Check, ChevronRight, Loader2, Plus, Search, X } from "lucide-react";
import { Badge, Button, Input } from "@/components/ui";
import { CancelBookingDialog, type StaffCancelTarget } from "@/components/bookings/cancel-booking-dialog";
import { useWorkspace } from "@/lib/workspace-context";
import {
  memberPackagesForClass,
  packagePick,
  searchMembers,
  seatTag,
  seatsSummary,
  staffBookClass,
  type ClassSeats,
  type MemberMatch,
  type PackagePick,
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
import type { ScheduleClassAttendee, ScheduleClassCancelled } from "@/lib/schedule";
import { formatDate } from "@/lib/formatters";

export function Stat({
  label,
  value,
  sub,
  tone = "ink",
}: {
  label: string;
  value: string;
  sub?: string;
  /** `warning` when the number is past what the room holds. */
  tone?: "ink" | "warning";
}) {
  return (
    <div className="min-w-0 rounded-xl border border-border bg-card p-4 shadow-soft">
      <div className="text-xs font-medium uppercase tracking-wide text-muted">{label}</div>
      <div
        className={`mt-1 whitespace-nowrap text-lg font-semibold tabular-nums ${
          tone === "warning" ? "text-warning" : "text-ink"
        }`}
      >
        {value}
      </div>
      {sub && <div className="truncate text-xs text-muted">{sub}</div>}
    </div>
  );
}

/** One kind of seat: its label, used / capacity, and a bar that fills with it. */
function SeatLine({ label, used, capacity }: { label: string; used: number; capacity: number }) {
  const over = used > capacity;
  const pct = capacity > 0 ? Math.min(100, Math.round((used / capacity) * 100)) : used > 0 ? 100 : 0;
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span className="text-muted">{label}</span>
        <span className={`font-semibold tabular-nums ${over ? "text-warning" : "text-ink"}`}>
          {used} / {capacity}
        </span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-warm" aria-hidden>
        <div
          className={`h-full rounded-full ${over ? "bg-warning" : "bg-accent"}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

/**
 * "Booked 8 / 16", the seats by kind (online and buffer, each on its own
 * line so neither wraps mid-number), and the waitlist.
 */
export function SeatStats({ seats }: { seats: ClassSeats & Pick<ClassWaitlist, "waiting" | "capacity_waitlist"> }) {
  const s = seatsSummary(seats);
  const noLine = seats.capacity_waitlist === 0 && seats.waiting === 0;
  return (
    <>
      <Stat
        label="Booked"
        value={s.booked}
        sub="of attendance capacity"
        tone={seats.attending > seats.attendance_capacity ? "warning" : "ink"}
      />
      <div className="min-w-0 rounded-xl border border-border bg-card p-4 shadow-soft">
        <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">Seats</div>
        <div className="space-y-2">
          <SeatLine label="Online" used={seats.online_used} capacity={seats.capacity_online} />
          <SeatLine label="Buffer" used={seats.buffer_used} capacity={seats.capacity_buffer} />
        </div>
        {s.overbooked && <div className="mt-2 text-xs font-medium text-warning">{s.overbooked}</div>}
      </div>
      <Stat
        label="Waitlist"
        value={noLine ? "None" : waitlistStat(seats)}
        sub={noLine ? "no waitlist on this class" : "waiting / places"}
      />
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
  cancelledBookings,
  cancelled,
  canAdd,
  canCancel,
  onChanged,
}: {
  role: StaffRole;
  classId: string;
  attendees: ScheduleClassAttendee[];
  /** Bookings cancelled off the class: listed apart, with no check-in or cancel. */
  cancelledBookings: ScheduleClassCancelled[];
  cancelled: boolean;
  /** Add member is offered only while the class can still be booked. */
  canAdd: boolean;
  /** Whether a booking's Cancel is offered at all (an Instructor needs Manage rosters). */
  canCancel: boolean;
  /** A member was added or cancelled: reload the class so the stats and roster agree. */
  onChanged: () => void;
}) {
  const rows = attendees;
  /** The booking whose cancel is waiting on the Return / Keep credit choice. */
  const [cancelling, setCancelling] = useState<StaffCancelTarget | null>(null);

  // Attendance is read here, not changed: marking someone attended (and
  // taking it back) is the check-in desk's job alone.
  const attendedCount = rows.filter((r) => r.check_in_state === "attended").length;

  return (
    <section className="mt-6 rounded-xl border border-border bg-card p-4 shadow-soft sm:p-5">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-ink">Booked customers ({rows.length})</h2>
        {rows.length > 0 && (
          <span className="text-xs text-muted">{attendedCount} checked in</span>
        )}
      </div>
      {canAdd && <AddMember role={role} classId={classId} onBooked={onChanged} />}
      {rows.length === 0 ? (
        <p className="text-sm text-muted">
          {cancelled && cancelledBookings.length > 0
            ? "The class was cancelled. Who was booked is under Cancelled below."
            : "No bookings yet."}
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {rows.map((a) => {
            const attended = a.check_in_state === "attended";
            const noShow = a.check_in_state === "no_show";
            const tag = seatTag(a.seat);
            return (
              <li
                key={a.booking_id}
                className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 py-2.5 text-sm"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    {role === "admin" ? (
                      <Link
                        href={`/admin/customers/${a.client.id}`}
                        className="min-w-0 truncate text-ink hover:text-accent"
                      >
                        {a.client.name}
                      </Link>
                    ) : (
                      <span className="min-w-0 truncate text-ink">{a.client.name}</span>
                    )}
                    {a.promoted_from_waitlist && <Badge tone="cyan">Promoted from waitlist</Badge>}
                    {tag && (
                      <Badge tone={a.seat === "overbook" ? "warning" : "neutral"}>{tag}</Badge>
                    )}
                  </div>
                  <div className="text-xs text-muted">
                    {a.package_kind ? PACKAGE_KIND_LABEL[a.package_kind] : "—"} ·{" "}
                    <span className="font-mono">{a.code}</span>
                  </div>
                </div>
                <div className="ml-auto flex shrink-0 items-center gap-2">
                  {attended && (
                    <Badge tone="sage">
                      <Check className="mr-1 h-3 w-3" />
                      Checked in
                    </Badge>
                  )}
                  {noShow && !attended && <Badge tone="error">No-show</Badge>}
                  {/* Confirmed and not attended: the backend sends a preview only then. */}
                  {canCancel && !cancelled && a.cancel_preview && (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="h-10 text-error hover:bg-error/10 hover:text-error sm:h-8"
                      onClick={() =>
                        setCancelling({ bookingId: a.booking_id, name: a.client.name, preview: a.cancel_preview! })
                      }
                    >
                      Cancel
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {cancelledBookings.length > 0 && (
        <CancelledSection role={role} rows={cancelledBookings} open={cancelled && rows.length === 0} />
      )}
      <CancelBookingDialog
        role={role}
        target={cancelling}
        onClose={() => setCancelling(null)}
        onCancelled={() => {
          setCancelling(null);
          onChanged();
        }}
      />
    </section>
  );
}

/**
 * The bookings cancelled off the class (#352), collapsed under the roster:
 * who, when it was cancelled and by whom, and where the credit went, a Late
 * cancel marked. Open from the start on a cancelled class, where it is the
 * whole of who was booked. Never checked in, never cancelled again.
 */
function CancelledSection({ role, rows, open }: { role: StaffRole; rows: ScheduleClassCancelled[]; open: boolean }) {
  return (
    <details open={open} className="group mt-4 border-t border-border pt-3">
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-1.5 text-sm font-medium text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent [&::-webkit-details-marker]:hidden">
        <ChevronRight className="h-4 w-4 text-muted transition-transform group-open:rotate-90" aria-hidden />
        Cancelled ({rows.length})
      </summary>
      <ul className="divide-y divide-border">
        {rows.map((b) => {
          const when = b.cancelled_at
            ? formatDate(b.cancelled_at, "d MMM, h:mma").replace(/(AM|PM)/, (m) => m.toLowerCase())
            : null;
          return (
            <li
              key={b.booking_id}
              className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 py-2.5 text-sm"
            >
              <div className="min-w-0 flex-1">
                {role === "admin" ? (
                  <Link href={`/admin/customers/${b.client.id}`} className="min-w-0 truncate text-ink hover:text-accent">
                    {b.client.name}
                  </Link>
                ) : (
                  <span className="min-w-0 truncate text-ink">{b.client.name}</span>
                )}
                <div className="text-xs text-muted">
                  {when ? `Cancelled ${when}` : "Cancelled"} by {b.who_line}
                </div>
              </div>
              <div className="ml-auto flex shrink-0 items-center gap-2">
                {/* A Late cancel reads "Late cancel · credit kept", toned as a warning. */}
                <Badge tone={b.late ? "warning" : "neutral"}>{b.outcome_line}</Badge>
              </div>
            </li>
          );
        })}
      </ul>
    </details>
  );
}

/**
 * Which of the member's packages pays, when more than one can (#333). The
 * Default payer comes chosen; Ineligible packages are listed greyed with their
 * reason so staff can tell the member why.
 */
function PackageChoice({
  pick,
  chosen,
  busy,
  onChange,
  onBook,
  onCancel,
}: {
  pick: PackagePick;
  chosen: string;
  busy: boolean;
  onChange: (id: string) => void;
  onBook: () => void;
  onCancel: () => void;
}) {
  const note = pick.options.find((o) => o.id === chosen)?.note;
  return (
    <div className="mt-2 space-y-1.5 rounded-md border border-border bg-card p-2.5">
      <label htmlFor="roster-package" className="text-xs font-medium text-muted">
        Pay with
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <select
          id="roster-package"
          value={chosen}
          disabled={busy}
          onChange={(e) => onChange(e.target.value)}
          className="h-10 min-w-0 flex-1 rounded-md border border-border bg-card px-3 py-2 text-sm disabled:opacity-60 sm:h-8 sm:py-1"
        >
          {pick.options.map((o) => (
            <option key={o.id} value={o.id} disabled={o.disabled}>
              {o.disabled ? `${o.label} — ${o.note}` : o.label}
            </option>
          ))}
        </select>
        <Button type="button" size="sm" className="h-10 sm:h-8" disabled={busy} onClick={onBook}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Book"}
        </Button>
        <Button type="button" variant="ghost" size="sm" className="h-10 sm:h-8" disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
      </div>
      {note && <p className="text-xs text-muted">{note}</p>}
    </div>
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
  /**
   * The member a refusal is about, what it said, and the package staff picked —
   * kept so Overbook books with the same one.
   */
  const [refusal, setRefusal] = useState<{
    member: MemberMatch;
    refusal: StaffBookingPrompt;
    packageId: string | null;
  } | null>(null);
  const [added, setAdded] = useState<string | null>(null);
  /** A member with more than one package that can pay, while staff choose which. */
  const [choosing, setChoosing] = useState<{ member: MemberMatch; pick: PackagePick; chosen: string } | null>(null);

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
    setChoosing(null);
  }

  /**
   * Add: read the member's packages first. With more than one that can pay,
   * staff choose which (as the member would); otherwise book straight away.
   */
  async function add(member: MemberMatch) {
    if (!api || busyId) return;
    setBusyId(member.id);
    setRefusal(null);
    setAdded(null);
    setChoosing(null);
    let pick: PackagePick | null;
    try {
      pick = packagePick(await memberPackagesForClass(api, role, classId, member.id));
    } catch (e) {
      setRefusal({ member, refusal: staffBookingPrompt(e, role), packageId: null });
      setBusyId(null);
      return;
    }
    setBusyId(null);
    if (pick) setChoosing({ member, pick, chosen: pick.defaultId });
    else await book(member);
  }

  async function book(member: MemberMatch, overbook = false, packageId: string | null = null) {
    if (!api || busyId) return;
    setBusyId(member.id);
    setRefusal(null);
    setAdded(null);
    // The pick travels with a refusal from here, so Overbook charges what was
    // chosen; a select left open beside the prompt could say otherwise.
    setChoosing(null);
    try {
      const res = await staffBookClass(api, role, classId, member.id, overbook, packageId);
      setAdded(
        res.seat === "overbook"
          ? `${member.name} was added as an overbooking.`
          : `${member.name} was added to a buffer seat.`,
      );
      close();
      onBooked();
    } catch (e) {
      setRefusal({ member, refusal: staffBookingPrompt(e, role), packageId });
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
      setRefusal({ member, refusal: { kind: "error", message: staffJoinRefusal(e) }, packageId: null });
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
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="h-10 sm:h-8"
          onClick={() => setOpen(true)}
        >
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
          onChange={(e) => {
            setQ(e.target.value);
            setChoosing(null);
          }}
          placeholder="Search members by name, email or phone"
          aria-label="Search members"
        />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-10 w-10"
          onClick={close}
          aria-label="Close"
        >
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
                  onClick={() => book(refusal.member, true, refusal.packageId)}
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
          <li key={m.id} className="py-2 text-sm">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate text-ink">{m.name}</div>
                <div className="truncate text-xs text-muted">{m.email}</div>
              </div>
              {choosing?.member.id !== m.id && (
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  className="h-10 sm:h-8"
                  disabled={busyId !== null}
                  onClick={() => add(m)}
                >
                  {busyId === m.id ? <Loader2 className="h-4 w-4 animate-spin" /> : "Add"}
                </Button>
              )}
            </div>
            {choosing?.member.id === m.id && (
              <PackageChoice
                pick={choosing.pick}
                chosen={choosing.chosen}
                busy={busyId === m.id}
                onChange={(chosen) => setChoosing({ ...choosing, chosen })}
                onBook={() => book(m, false, choosing.chosen)}
                onCancel={() => setChoosing(null)}
              />
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
