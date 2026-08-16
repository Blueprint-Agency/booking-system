"use client";
import { useCallback, useEffect, useState } from "react";
import { Save, Info, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button, Input, Label, PageHeader } from "@/components/ui";
import { useWorkspace } from "@/lib/workspace-context";
import { ApiError } from "@/lib/api";

interface PolicyState {
  cancelCapCount: number;
  cancelCapCycleDays: number;
  classWindowHours: number;
  ptWindowHours: number;
  leaveCarryOverCapDays: number;
  coverGroupLeaveCap: number;
  studyLeaveCap: number;
  bookInAdvanceDays: number;
  updatedAt: string | null;
}

interface ApiPolicy {
  global_policy: {
    cancel_cap_count: number;
    cancel_cap_cycle_days: number;
    class_window_hours: number;
    pt_window_hours: number;
    leave_carry_over_cap_days: number;
    cover_group_leave_cap: number;
    study_leave_cap: number;
    updated_at: string | null;
  };
  pt_booking_config: {
    book_in_advance_days: number;
    updated_at: string | null;
  };
  /** The Cover Group, as one ticked set of instructor staff user ids. */
  cover_group_staff_ids: string[];
}

interface StaffRow {
  id: string;
  name: string;
  role: "superadmin" | "admin" | "instructor";
  status: "pending" | "active" | "archived";
}

function emptyPolicy(): PolicyState {
  return {
    cancelCapCount: 0,
    cancelCapCycleDays: 0,
    classWindowHours: 0,
    ptWindowHours: 0,
    leaveCarryOverCapDays: 0,
    coverGroupLeaveCap: 1,
    studyLeaveCap: 1,
    bookInAdvanceDays: 0,
    updatedAt: null,
  };
}

function diffGlobal(saved: PolicyState, draft: PolicyState) {
  const out: Record<string, number> = {};
  if (saved.cancelCapCount !== draft.cancelCapCount)
    out.cancel_cap_count = draft.cancelCapCount;
  if (saved.cancelCapCycleDays !== draft.cancelCapCycleDays)
    out.cancel_cap_cycle_days = draft.cancelCapCycleDays;
  if (saved.classWindowHours !== draft.classWindowHours)
    out.class_window_hours = draft.classWindowHours;
  if (saved.ptWindowHours !== draft.ptWindowHours)
    out.pt_window_hours = draft.ptWindowHours;
  if (saved.leaveCarryOverCapDays !== draft.leaveCarryOverCapDays)
    out.leave_carry_over_cap_days = draft.leaveCarryOverCapDays;
  if (saved.coverGroupLeaveCap !== draft.coverGroupLeaveCap)
    out.cover_group_leave_cap = draft.coverGroupLeaveCap;
  if (saved.studyLeaveCap !== draft.studyLeaveCap) out.study_leave_cap = draft.studyLeaveCap;
  return out;
}

export default function PolicyPage() {
  const { api } = useWorkspace();
  const [policy, setPolicy] = useState<PolicyState>(emptyPolicy);
  const [draft, setDraft] = useState<PolicyState>(emptyPolicy);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // The Cover Group is a set, so it is held apart from the numeric policy state
  // and compared as a set — order carries no meaning.
  const [instructors, setInstructors] = useState<StaffRow[]>([]);
  const [coverGroup, setCoverGroup] = useState<string[]>([]);
  const [savedCoverGroup, setSavedCoverGroup] = useState<string[]>([]);

  const load = useCallback(async () => {
    if (!api) return;
    setLoading(true);
    setError(null);
    try {
      const [r, staff] = await Promise.all([
        api.get<ApiPolicy>("/portal/admin/policy"),
        api.get<{ staff: StaffRow[] }>("/portal/admin/staff"),
      ]);
      setInstructors(
        staff.staff.filter((m) => m.role === "instructor" && m.status !== "archived"),
      );
      setCoverGroup(r.cover_group_staff_ids);
      setSavedCoverGroup(r.cover_group_staff_ids);
      const next: PolicyState = {
        cancelCapCount: r.global_policy.cancel_cap_count,
        cancelCapCycleDays: r.global_policy.cancel_cap_cycle_days,
        classWindowHours: r.global_policy.class_window_hours,
        ptWindowHours: r.global_policy.pt_window_hours,
        leaveCarryOverCapDays: r.global_policy.leave_carry_over_cap_days,
        coverGroupLeaveCap: r.global_policy.cover_group_leave_cap,
        studyLeaveCap: r.global_policy.study_leave_cap,
        bookInAdvanceDays: r.pt_booking_config.book_in_advance_days,
        updatedAt: r.global_policy.updated_at,
      };
      setPolicy(next);
      setDraft(next);
    } catch (err) {
      setError(err instanceof ApiError ? `HTTP ${err.status}` : "Network error");
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  const sameSet = (a: string[], b: string[]) =>
    a.length === b.length && a.every((id) => b.includes(id));

  const dirty =
    !sameSet(coverGroup, savedCoverGroup) ||
    draft.coverGroupLeaveCap !== policy.coverGroupLeaveCap ||
    draft.studyLeaveCap !== policy.studyLeaveCap ||
    draft.cancelCapCount !== policy.cancelCapCount ||
    draft.cancelCapCycleDays !== policy.cancelCapCycleDays ||
    draft.classWindowHours !== policy.classWindowHours ||
    draft.ptWindowHours !== policy.ptWindowHours ||
    draft.leaveCarryOverCapDays !== policy.leaveCarryOverCapDays ||
    draft.bookInAdvanceDays !== policy.bookInAdvanceDays;

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!api) return;
    setSaving(true);
    try {
      const globalDelta: Record<string, unknown> = diffGlobal(policy, draft);
      if (!sameSet(coverGroup, savedCoverGroup)) globalDelta.cover_group_staff_ids = coverGroup;
      const ops: Array<Promise<unknown>> = [];
      if (Object.keys(globalDelta).length > 0) {
        ops.push(api.patch("/portal/admin/policy/global", globalDelta));
      }
      if (draft.bookInAdvanceDays !== policy.bookInAdvanceDays) {
        ops.push(
          api.patch("/portal/admin/policy/pt", {
            book_in_advance_days: draft.bookInAdvanceDays,
          }),
        );
      }
      await Promise.all(ops);
      toast.success("Policy saved.");
      await load();
    } catch (err) {
      toast.error(err instanceof ApiError ? `Save failed (HTTP ${err.status}).` : "Save failed.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center gap-2 text-sm text-muted">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading policy…
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto max-w-3xl rounded-xl border border-error/30 bg-error/5 p-6 text-center">
        <p className="text-sm text-error">Failed to load: {error}</p>
        <Button size="sm" variant="ghost" onClick={load} className="mt-2">
          Retry
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Global Policy"
        description="Single source of truth for customer-initiated class and PT cancellation. Workshops are non-refundable; package purchases are non-cancellable."
      />

      <form onSubmit={handleSave} className="space-y-6">
        <section className="rounded-xl border border-border bg-card p-6 shadow-soft">
          <header className="mb-4">
            <h2 className="text-base font-semibold text-ink">Cancellation cap</h2>
            <p className="mt-0.5 text-xs text-muted">
              How many cancellations a customer gets per cycle. Applies universally — no per-customer overrides. Counts class + PT together.
            </p>
          </header>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="cap-count">Max cancellations</Label>
              <Input
                id="cap-count"
                type="number"
                min={0}
                value={draft.cancelCapCount}
                onChange={(e) =>
                  setDraft({ ...draft, cancelCapCount: Number(e.target.value) })
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cap-cycle">Cycle (days)</Label>
              <Input
                id="cap-cycle"
                type="number"
                min={1}
                value={draft.cancelCapCycleDays}
                onChange={(e) =>
                  setDraft({ ...draft, cancelCapCycleDays: Number(e.target.value) })
                }
              />
            </div>
          </div>
          <p className="mt-3 inline-flex items-start gap-1.5 text-xs text-muted">
            <Info className="mt-0.5 h-3 w-3" />
            Currently:{" "}
            <span className="font-medium text-ink">
              {draft.cancelCapCount} cancellations per {draft.cancelCapCycleDays} days
            </span>
            . No-shows do not count toward this cap.
          </p>
        </section>

        <section className="rounded-xl border border-border bg-card p-6 shadow-soft">
          <header className="mb-4">
            <h2 className="text-base font-semibold text-ink">Cancellation windows</h2>
            <p className="mt-0.5 text-xs text-muted">
              How far in advance customers must cancel for a refund. Cancellation itself is always allowed; the window only gates whether credits/sessions are returned.
            </p>
          </header>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="class-window">Class window (hours)</Label>
              <Input
                id="class-window"
                type="number"
                min={0}
                value={draft.classWindowHours}
                onChange={(e) =>
                  setDraft({ ...draft, classWindowHours: Number(e.target.value) })
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pt-window">PT window (hours)</Label>
              <Input
                id="pt-window"
                type="number"
                min={0}
                value={draft.ptWindowHours}
                onChange={(e) =>
                  setDraft({ ...draft, ptWindowHours: Number(e.target.value) })
                }
              />
            </div>
          </div>
        </section>

        <section className="rounded-xl border border-border bg-card p-6 shadow-soft">
          <header className="mb-4">
            <h2 className="text-base font-semibold text-ink">PT booking horizon</h2>
            <p className="mt-0.5 text-xs text-muted">
              How far in advance customers can request a Private Training session.
            </p>
          </header>
          <div className="space-y-1.5 max-w-xs">
            <Label htmlFor="pt-horizon">Book in advance (days)</Label>
            <Input
              id="pt-horizon"
              type="number"
              min={1}
              max={365}
              value={draft.bookInAdvanceDays}
              onChange={(e) =>
                setDraft({ ...draft, bookInAdvanceDays: Number(e.target.value) })
              }
            />
          </div>
        </section>

        <section className="rounded-xl border border-border bg-card p-6 shadow-soft">
          <header className="mb-4">
            <h2 className="text-base font-semibold text-ink">Leave carry-over</h2>
            <p className="mt-0.5 text-xs text-muted">
              The most unused annual days an instructor can take into the next leave year.
              Applies studio-wide — an instructor&apos;s yearly assigned days are set on their
              own staff profile.
            </p>
          </header>
          <div className="max-w-xs space-y-1.5">
            <Label htmlFor="leave-carry-cap">Carry-over cap (days)</Label>
            <Input
              id="leave-carry-cap"
              type="number"
              min={0}
              max={365}
              value={draft.leaveCarryOverCapDays}
              onChange={(e) =>
                setDraft({ ...draft, leaveCarryOverCapDays: Number(e.target.value) })
              }
            />
          </div>
          <p className="mt-3 inline-flex items-start gap-1.5 text-xs text-muted">
            <Info className="mt-0.5 h-3 w-3" />
            Medical leave never carries over, and a change here applies to the next leave year
            onwards — pools already opened do not move.
          </p>
        </section>

        <section className="rounded-xl border border-border bg-card p-6 shadow-soft">
          <header className="mb-4">
            <h2 className="text-base font-semibold text-ink">Leave caps</h2>
            <p className="mt-0.5 text-xs text-muted">
              The most instructors who may be away at the same moment. Measured as a peak across
              the requested dates, so leave that never coincides never reaches a cap. Medical
              leave counts toward a cap and is never refused by one.
            </p>
          </header>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="cover-group-cap">Cover Group cap (instructors)</Label>
              <Input
                id="cover-group-cap"
                type="number"
                min={1}
                max={365}
                value={draft.coverGroupLeaveCap}
                onChange={(e) =>
                  setDraft({ ...draft, coverGroupLeaveCap: Number(e.target.value) })
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="study-cap">Study leave cap (instructors)</Label>
              <Input
                id="study-cap"
                type="number"
                min={1}
                max={365}
                value={draft.studyLeaveCap}
                onChange={(e) => setDraft({ ...draft, studyLeaveCap: Number(e.target.value) })}
              />
            </div>
          </div>
          <div className="mt-5 space-y-1.5">
            <Label htmlFor="cover-group">Cover Group</Label>
            <p className="text-xs text-muted">
              The instructors who cover each other. Tick nobody and the Cover Group cap refuses
              nothing. The study cap counts every instructor either way.
            </p>
            <select
              id="cover-group"
              multiple
              size={Math.min(Math.max(instructors.length, 3), 8)}
              className="w-full rounded-md border border-border bg-card p-2 text-sm text-ink"
              value={coverGroup}
              onChange={(e) =>
                setCoverGroup(Array.from(e.target.selectedOptions, (o) => o.value))
              }
            >
              {instructors.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
            <p className="text-xs text-muted">
              {coverGroup.length === 0
                ? "Nobody is in the Cover Group."
                : `${coverGroup.length} in the Cover Group.`}
            </p>
          </div>
        </section>

        <div className="flex items-center justify-between">
          <span className="text-xs text-muted">
            {policy.updatedAt
              ? `Last updated ${new Date(policy.updatedAt).toLocaleString()}`
              : "Not yet saved."}
          </span>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="ghost"
              disabled={!dirty || saving}
              onClick={() => {
                setDraft(policy);
                setCoverGroup(savedCoverGroup);
              }}
            >
              Reset
            </Button>
            <Button type="submit" disabled={!dirty || saving}>
              {saving ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Saving…
                </>
              ) : (
                <>
                  <Save className="h-4 w-4" /> Save policy
                </>
              )}
            </Button>
          </div>
        </div>
      </form>
    </div>
  );
}
