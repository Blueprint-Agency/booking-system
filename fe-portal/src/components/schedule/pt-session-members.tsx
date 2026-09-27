"use client";
// A private session's members on its detail page (#338). Every session lists
// who is on it, their check-in and the package paying their seat. A manual one
// (staff put it on with no member request) is also managed here while it is to
// come: remove one member (refunded on their own package, the others stay),
// fill a free seat through the same package pick and Add anyway band as Add
// manually, and — an Admin's alone — change the type, a downgrade confirming
// who leaves and an upgrade asking for the partner through that same row.

import { useState } from "react";
import Link from "next/link";
import { Loader2, Plus, UserMinus } from "lucide-react";
import { Badge, Button } from "@/components/ui";
import { AddSeatForm } from "@/components/schedule/pt-seat";
import { useWorkspace } from "@/lib/workspace-context";
import { computeEventState } from "@/lib/event-state";
import type { StaffRole } from "@/lib/class-seats";
import type { InstructorPtDetail, SchedulePtAttendee } from "@/lib/schedule";
import {
  addMemberBody,
  addSessionMember,
  canAddMember,
  downgradeConfirm,
  isManual,
  removeSessionMember,
  retypeBody,
  retypeSession,
  seatLimit,
  sessionActionErrorMessage,
} from "@/lib/pt-manual";

export function PtSessionMembers({
  role,
  data,
  onChanged,
}: {
  role: StaffRole;
  data: InstructorPtDetail;
  onChanged: () => void | Promise<void>;
}) {
  const { api, may } = useWorkspace();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [upgrading, setUpgrading] = useState(false);

  const state = computeEventState({ startsAt: data.starts_at, endsAt: data.ends_at, lifecycle: data.lifecycle });
  // Once it has ended its seats were used; the backend refuses `session_ended`.
  // Changing who is on a private session is Take PT bookings' (an Admin always
  // may); without it the list still reads, and the actions are gone.
  const editable = isManual(data) && may("take_pt_bookings") && (state === "scheduled" || state === "ongoing");
  const limit = seatLimit(data.session_type);
  const onIt = data.clients.map((c) => c.id);

  async function run(key: string, action: () => Promise<unknown>, fallback: string) {
    if (!api) return;
    setBusy(key);
    setErr(null);
    try {
      await action();
      await onChanged();
    } catch (e) {
      setErr(sessionActionErrorMessage(e, fallback));
    } finally {
      setBusy(null);
    }
  }

  function remove(cl: SchedulePtAttendee) {
    if (!api) return;
    if (!confirm(`Remove ${cl.name} from this session? They get their session back on their own package.`)) return;
    void run(cl.id, () => removeSessionMember(api, role, data.id, cl.id), "Couldn't remove them");
  }

  function downgrade() {
    if (!api || !confirm(downgradeConfirm(data.clients))) return;
    void run("retype", () => retypeSession(api, data.id, { session_type: "1on1" }), "Couldn't change the type");
  }

  const retypeControl =
    role === "admin" && editable && !upgrading ? (
      data.session_type === "2on1" ? (
        <Button type="button" variant="ghost" size="sm" onClick={downgrade} disabled={busy !== null}>
          {busy === "retype" && <Loader2 className="h-4 w-4 animate-spin" />}
          Change to 1-on-1
        </Button>
      ) : (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => {
            setUpgrading(true);
            setAdding(false);
          }}
          disabled={busy !== null}
        >
          Change to 2-on-1
        </Button>
      )
    ) : null;

  return (
    <section className="rounded-xl border border-border bg-card p-4 shadow-soft sm:p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-ink">
          Members ({data.clients.length} / {limit})
        </h2>
        {retypeControl}
      </div>

      {data.clients.length === 0 ? (
        <p className="text-sm text-muted">No members on this session.</p>
      ) : (
        <ul className="divide-y divide-border">
          {data.clients.map((cl) => (
            <li key={cl.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 py-2.5 text-sm">
              <div className="min-w-0 flex-1">
                {role === "admin" ? (
                  <Link href={`/admin/customers/${cl.id}`} className="text-ink hover:text-accent">
                    {cl.name}
                  </Link>
                ) : (
                  <span className="text-ink">{cl.name}</span>
                )}
                <div className="break-words text-xs text-muted">
                  {[cl.code && `Code ${cl.code}`, paidFrom(cl)].filter(Boolean).join(" · ")}
                </div>
              </div>
              <div className="ml-auto flex shrink-0 items-center gap-2">
                <PtCheckInBadge state={cl.check_in_state} />
                {/* The last member off is a cancel, not a removal: use Cancel session. */}
                {editable && data.clients.length > 1 && cl.check_in_state !== "attended" && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-10 text-error hover:text-error sm:h-8"
                    onClick={() => remove(cl)}
                    disabled={busy !== null}
                    aria-label={`Remove ${cl.name}`}
                  >
                    {busy === cl.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserMinus className="h-4 w-4" />}
                    Remove
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {err && (
        <p role="alert" className="mt-3 rounded-md border border-error/30 bg-error/5 px-3 py-2 text-xs text-error">
          {err}
        </p>
      )}

      {upgrading && api && (
        <div className="mt-4">
          <AddSeatForm
            role={role}
            sessionType="2on1"
            instructorId={data.main_instructor_id}
            exclude={onIt}
            submitLabel="Change to 2-on-1"
            hint="Add the partner who joins. They pay one session from their own package; nobody else's balance moves."
            build={(seat) => retypeBody("2on1", seat)}
            send={(body) => retypeSession(api, data.id, body)}
            onDone={async () => {
              setUpgrading(false);
              await onChanged();
            }}
            onCancel={() => setUpgrading(false)}
          />
        </div>
      )}

      {editable && !upgrading && canAddMember(data) && api && (
        <div className="mt-4">
          {adding ? (
            <AddSeatForm
              role={role}
              sessionType={data.session_type}
              instructorId={data.main_instructor_id}
              exclude={onIt}
              submitLabel="Add member"
              build={addMemberBody}
              send={(body) => addSessionMember(api, role, data.id, body)}
              onDone={async () => {
                setAdding(false);
                await onChanged();
              }}
              onCancel={() => setAdding(false)}
            />
          ) : (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="h-10 sm:h-8"
              onClick={() => setAdding(true)}
              disabled={busy !== null}
            >
              <Plus className="h-4 w-4" /> Add member
            </Button>
          )}
        </div>
      )}
    </section>
  );
}

function paidFrom(cl: SchedulePtAttendee): string | null {
  if (!cl.package) return null;
  const left = cl.package.sessions_left;
  return `Paid from ${cl.package.name ?? "PT package"}${
    left === null ? "" : ` · ${left} ${left === 1 ? "session" : "sessions"} left`
  }`;
}

function PtCheckInBadge({ state }: { state: SchedulePtAttendee["check_in_state"] }) {
  if (state === "attended") return <Badge tone="sage">Checked in</Badge>;
  if (state === "no_show") return <Badge tone="error">No-show</Badge>;
  if (state === "pending") return <Badge tone="neutral">Pending</Badge>;
  return null;
}
