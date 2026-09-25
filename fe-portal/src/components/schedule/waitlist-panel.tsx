"use client";
// The class session page's Waitlist panel, shared by the admin and instructor
// portals (spec-waitlist.md §10): the line in order, whether each member's
// package could pay, and per row Add to class / Remove. The line is worked here
// even with the studio's waitlists switched off — the switch stops new joins,
// it never strands the members already in line (§8).

import { useState } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { Badge, Button } from "@/components/ui";
import { useWorkspace } from "@/lib/workspace-context";
import { formatDateTime } from "@/lib/formatters";
import type { StaffRole } from "@/lib/class-seats";
import {
  addToClassRefusal,
  paymentStatusLine,
  promoteWaitlistEntry,
  removeWaitlistEntry,
  type AddToClassRefusal,
  type ClassWaitlist,
  type WaitlistRow,
} from "@/lib/class-waitlist";

export function WaitlistPanel({
  role,
  classId,
  data,
  canAct,
  onChanged,
  noLineHint,
}: {
  role: StaffRole;
  classId: string;
  data: ClassWaitlist;
  /** Rows can be worked only while the class has not started. */
  canAct: boolean;
  /** The line or the roster changed: reload the class. */
  onChanged: () => void;
  /** What to do about a class with no waitlist — where its size is set, for whoever can set it. */
  noLineHint?: string;
}) {
  // A class with no line still says so, rather than leaving staff to wonder
  // where the waitlist went.
  if (data.waitlist.length === 0 && data.capacity_waitlist === 0) {
    return (
      <section
        aria-label="Waitlist"
        className="mt-6 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 rounded-xl border border-dashed border-border bg-card px-5 py-4"
      >
        <h2 className="text-sm font-semibold text-ink">Waitlist</h2>
        <p className="text-xs text-muted">
          No waitlist on this class{noLineHint ? ` — ${noLineHint}` : "."}
        </p>
      </section>
    );
  }
  return (
    <section
      aria-label="Waitlist"
      className="mt-6 rounded-xl border border-border bg-card p-4 shadow-soft sm:p-5"
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-ink">Waitlist ({data.waitlist.length})</h2>
        <span className="text-xs text-muted">
          {data.waiting} of {data.capacity_waitlist} places taken
        </span>
      </div>
      {!data.waitlist_enabled && (
        <p className="mb-3 text-xs text-muted">
          Waitlists are off for the studio: members can&apos;t join, but this line can still be worked.
        </p>
      )}
      {data.waitlist.length === 0 ? (
        <p className="text-sm text-muted">Nobody is waiting.</p>
      ) : (
        <ol className="divide-y divide-border">
          {data.waitlist.map((w) => (
            <WaitlistEntry
              key={w.entry_id}
              role={role}
              classId={classId}
              row={w}
              canAct={canAct}
              onChanged={onChanged}
            />
          ))}
        </ol>
      )}
    </section>
  );
}

function WaitlistEntry({
  role,
  classId,
  row,
  canAct,
  onChanged,
}: {
  role: StaffRole;
  classId: string;
  row: WaitlistRow;
  canAct: boolean;
  onChanged: () => void;
}) {
  const { api } = useWorkspace();
  const [busy, setBusy] = useState<"add" | "remove" | null>(null);
  const [refusal, setRefusal] = useState<AddToClassRefusal | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const canPay = row.payment_status.status === "pending";

  async function add(overbook = false) {
    if (!api || busy) return;
    setBusy("add");
    setRefusal(null);
    try {
      await promoteWaitlistEntry(api, role, classId, row.entry_id, overbook);
      onChanged();
    } catch (e) {
      setRefusal(addToClassRefusal(e, role));
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    if (!api || busy) return;
    setBusy("remove");
    setRefusal(null);
    try {
      await removeWaitlistEntry(api, role, classId, row.entry_id);
      onChanged();
    } catch (e) {
      // Only the wording is shared with Add to class; a failed Remove never asks to overbook.
      setRefusal({ kind: "error", message: addToClassRefusal(e, role).message });
      setConfirmRemove(false);
    } finally {
      setBusy(null);
    }
  }

  return (
    <li className="py-2.5 text-sm" data-testid="waitlist-row">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <span className="w-6 shrink-0 text-right font-semibold tabular-nums text-muted">
            #{row.position}
          </span>
          <div className="min-w-0">
            {role === "admin" ? (
              <Link href={`/admin/customers/${row.client.id}`} className="text-ink hover:text-accent">
                {row.client.name}
              </Link>
            ) : (
              <span className="text-ink">{row.client.name}</span>
            )}
            <div className="text-xs text-muted">Joined {formatDateTime(row.joined_at)}</div>
          </div>
        </div>
        <Badge tone={canPay ? "neutral" : "warning"}>{paymentStatusLine(row.payment_status)}</Badge>
        {canAct && !confirmRemove && (
          <div className="ml-auto flex shrink-0 items-center gap-2">
            <Button type="button" size="sm" variant="secondary" disabled={busy !== null} onClick={() => add()}>
              {busy === "add" && <Loader2 className="h-4 w-4 animate-spin" />}
              Add to class
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={busy !== null}
              onClick={() => setConfirmRemove(true)}
            >
              Remove
            </Button>
          </div>
        )}
        {canAct && confirmRemove && (
          <div className="ml-auto flex shrink-0 items-center gap-2">
            <span className="text-xs text-muted">Remove from the waitlist?</span>
            <Button type="button" size="sm" variant="secondary" disabled={busy !== null} onClick={remove}>
              {busy === "remove" && <Loader2 className="h-4 w-4 animate-spin" />}
              Remove
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setConfirmRemove(false)}>
              Keep
            </Button>
          </div>
        )}
      </div>

      {refusal?.kind === "full" && (
        <div
          role="alertdialog"
          aria-label="No seats left"
          className="mt-2 flex flex-wrap items-center gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-ink"
        >
          <span className="flex-1">{refusal.message}</span>
          <Button type="button" size="sm" disabled={busy !== null} onClick={() => add(true)}>
            Overbook
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setRefusal(null)}>
            Cancel
          </Button>
        </div>
      )}
      {refusal?.kind === "error" && (
        <p className="mt-2 rounded-md border border-error/30 bg-error/5 px-3 py-2 text-xs text-error">
          {refusal.message}
        </p>
      )}
    </li>
  );
}
