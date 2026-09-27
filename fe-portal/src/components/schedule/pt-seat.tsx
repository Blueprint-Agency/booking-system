"use client";
// A member paying one seat on a manual private session (#336, #338): the
// member search, and the row showing which of their packages pays — a select
// when more than one can, the warning band with Add anyway when it bends
// something they bought. Add manually holds several of these; the session
// detail page's add-member row and 2-on-1 upgrade hold one.

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Loader2, Search, X } from "lucide-react";
import { Button, Input } from "@/components/ui";
import { useWorkspace } from "@/lib/workspace-context";
import { searchMembers, type MemberMatch, type StaffRole } from "@/lib/class-seats";
import {
  fetchSeatCandidates,
  seatChoice,
  seatReadErrorMessage,
  seatWarnings,
  sessionActionErrorMessage,
  type ManualSeat,
  type PtSessionType,
  type SeatCandidates,
  type SeatChoice,
} from "@/lib/pt-manual";

/** One member on the roster, and what their packages say for the session's current shape. */
export interface SeatRow {
  member: MemberMatch;
  /** The session type and instructor the packages were (or are being) read for. */
  shape: string;
  state: "waiting" | "loading" | "ready" | "error";
  candidates: SeatCandidates | null;
  choice: SeatChoice | null;
  chosen: string | null;
  accepted: boolean;
  error: string | null;
}

export function toSeat(r: SeatRow, sessionType: PtSessionType): ManualSeat {
  const pkg = r.candidates?.packages.find((p) => p.id === r.chosen);
  return {
    clientId: r.member.id,
    name: r.member.name,
    packageId: r.state === "ready" ? r.chosen : null,
    warned: Boolean(pkg && seatWarnings(pkg, sessionType).length),
    accepted: r.accepted,
    ready: r.state === "ready",
    readError: r.state === "error" ? r.error : null,
  };
}

/**
 * One member on the roster: the package that pays (a select only when more
 * than one can), and the warning band with Add anyway when it bends something
 * the member bought.
 */
export function SeatRowView({
  row,
  sessionType,
  onRemove,
  onChoose,
  onAccept,
}: {
  row: SeatRow;
  sessionType: PtSessionType;
  onRemove: () => void;
  onChoose: (id: string) => void;
  onAccept: (accepted: boolean) => void;
}) {
  const { choice, chosen } = row;
  const pkg = row.candidates?.packages.find((p) => p.id === chosen) ?? null;
  const option = choice?.options.find((o) => o.id === chosen) ?? null;
  const warnings = pkg ? seatWarnings(pkg, sessionType) : [];
  const selectId = `manual-pt-pkg-${row.member.id}`;

  return (
    <li className="space-y-2 px-3 py-2.5 text-sm">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-ink">{row.member.name}</div>
          <div className="truncate text-xs text-muted">{row.member.email}</div>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-10 w-10 shrink-0"
          onClick={onRemove}
          aria-label={`Remove ${row.member.name}`}
        >
          <X className="h-4 w-4" />
        </Button>
      </div>

      {row.state === "waiting" && (
        <p className="text-xs text-muted">Pick an instructor to see this member&apos;s packages.</p>
      )}
      {row.state === "loading" && (
        <p className="flex items-center gap-1.5 text-xs text-muted">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Reading packages…
        </p>
      )}
      {row.state === "error" && <p className="text-xs text-error">{row.error}</p>}

      {row.state === "ready" && choice?.refusal && (
        <div className="space-y-1">
          <p className="text-xs text-error">{choice.refusal}</p>
          {choice.options.length > 0 && (
            <ul className="space-y-0.5 text-xs text-muted opacity-70">
              {choice.options.map((o) => (
                <li key={o.id}>
                  {o.label} — {o.note}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {row.state === "ready" && choice && !choice.refusal && (
        <div className="space-y-1">
          {choice.choosable ? (
            <>
              <label htmlFor={selectId} className="text-xs font-medium text-muted">
                Pay with
              </label>
              <select
                id={selectId}
                value={chosen ?? ""}
                onChange={(e) => onChoose(e.target.value)}
                className="h-10 w-full rounded-md border border-border bg-card px-3 py-2 text-sm sm:h-8 sm:py-1"
              >
                {choice.options.map((o) => (
                  <option key={o.id} value={o.id} disabled={o.disabled}>
                    {o.disabled ? `${o.label} — ${o.note}` : o.label}
                  </option>
                ))}
              </select>
            </>
          ) : (
            <p className="text-xs text-muted">
              Pays with <span className="text-ink">{option?.label}</span>
            </p>
          )}
          {option?.note && <p className="text-xs text-muted">{option.note}</p>}
        </div>
      )}

      {row.state === "ready" && warnings.length > 0 && (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-ink"
        >
          <AlertTriangle className="h-4 w-4 shrink-0 text-warning" />
          <span className="min-w-0 flex-1">
            {warnings.join(" ")}
            {row.accepted ? " Adding anyway: one session is charged from it." : ""}
          </span>
          {row.accepted ? (
            <Button type="button" size="sm" variant="ghost" onClick={() => onAccept(false)}>
              Undo
            </Button>
          ) : (
            <Button type="button" size="sm" variant="secondary" onClick={() => onAccept(true)}>
              Add anyway
            </Button>
          )}
        </div>
      )}
    </li>
  );
}

/** Find a member to add, as the class roster does. Someone already added can't be added twice. */
export function MemberSearch({
  role,
  added,
  onAdd,
}: {
  role: StaffRole;
  added: string[];
  onAdd: (m: MemberMatch) => void;
}) {
  const { api } = useWorkspace();
  const [q, setQ] = useState("");
  const [matches, setMatches] = useState<MemberMatch[]>([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    if (!api) return;
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
      // A search cut short by a new term, or by Add clearing it, must not leave "Searching…" up.
      setSearching(false);
    };
  }, [api, q, role]);

  const searchable = q.trim().length >= 2;
  const shown = searchable ? matches : [];

  return (
    <div className="rounded-lg border border-border bg-paper p-3">
      <div className="flex items-center gap-2">
        <Search className="h-4 w-4 shrink-0 text-muted" />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search members by name, email or phone"
          aria-label="Search members"
        />
      </div>
      <ul className="mt-2 divide-y divide-border">
        {searching && shown.length === 0 && <li className="py-2 text-xs text-muted">Searching…</li>}
        {!searching && searchable && shown.length === 0 && <li className="py-2 text-xs text-muted">No members match.</li>}
        {shown.map((m) => {
          const already = added.includes(m.id);
          return (
            <li key={m.id} className="flex items-center justify-between gap-3 py-2 text-sm">
              <div className="min-w-0">
                <div className="truncate text-ink">{m.name}</div>
                <div className="truncate text-xs text-muted">{m.email}</div>
              </div>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                className="h-10 sm:h-8"
                disabled={already}
                onClick={() => {
                  onAdd(m);
                  setQ("");
                  setMatches([]);
                }}
              >
                {already ? "Added" : "Add"}
              </Button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * One member onto an existing session: find them, see which package pays,
 * accept any warning, then send. `build` turns the seat into the call's body
 * (or the sentence saying what stops it); a refusal is worded from its code
 * and the member's packages are read again, since they may have changed.
 */
export function AddSeatForm<T>({
  role,
  sessionType,
  instructorId,
  exclude,
  submitLabel,
  hint,
  build,
  send,
  onDone,
  onCancel,
}: {
  role: StaffRole;
  /** The type the seat is read and paid for — the new one on an upgrade. */
  sessionType: PtSessionType;
  instructorId: string;
  /** Members already on the session. */
  exclude: string[];
  submitLabel: string;
  hint?: string;
  build: (seat: ManualSeat) => T | string;
  send: (body: T) => Promise<unknown>;
  onDone: () => void | Promise<void>;
  onCancel?: () => void;
}) {
  const { api } = useWorkspace();
  const [row, setRow] = useState<SeatRow | null>(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const read = useCallback(
    async (member: MemberMatch) => {
      if (!api) return;
      setRow({
        member,
        shape: `${sessionType}|${instructorId}`,
        state: "loading",
        candidates: null,
        choice: null,
        chosen: null,
        accepted: false,
        error: null,
      });
      try {
        const candidates = await fetchSeatCandidates(api, role, { clientId: member.id, sessionType, instructorId });
        const choice = seatChoice(candidates);
        setRow((r) =>
          r?.member.id === member.id ? { ...r, state: "ready", candidates, choice, chosen: choice.defaultId } : r,
        );
      } catch (e) {
        setRow((r) => (r?.member.id === member.id ? { ...r, state: "error", error: seatReadErrorMessage(e) } : r));
      }
    },
    [api, role, sessionType, instructorId],
  );

  async function submit() {
    if (!row || saving) return;
    const body = build(toSeat(row, sessionType));
    if (typeof body === "string") {
      setErr(body);
      return;
    }
    setSaving(true);
    setErr(null);
    try {
      await send(body);
      setRow(null);
      await onDone();
    } catch (e) {
      setErr(sessionActionErrorMessage(e, "Couldn't add them"));
      void read(row.member);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3 rounded-lg border border-border p-3">
      {hint && <p className="text-xs text-muted">{hint}</p>}
      {row ? (
        <ul className="rounded-lg border border-border">
          <SeatRowView
            row={row}
            sessionType={sessionType}
            onRemove={() => {
              setRow(null);
              setErr(null);
            }}
            onChoose={(chosen) => setRow((r) => r && { ...r, chosen, accepted: false })}
            onAccept={(accepted) => setRow((r) => r && { ...r, accepted })}
          />
        </ul>
      ) : (
        <MemberSearch
          role={role}
          added={exclude}
          onAdd={(m) => {
            setErr(null);
            void read(m);
          }}
        />
      )}
      {err && (
        <p role="alert" className="rounded-md border border-error/30 bg-error/5 px-3 py-2 text-xs text-error">
          {err}
        </p>
      )}
      <div className="flex flex-wrap justify-end gap-2">
        {onCancel && (
          <Button type="button" variant="ghost" size="sm" onClick={onCancel} disabled={saving}>
            Cancel
          </Button>
        )}
        <Button type="button" size="sm" onClick={submit} disabled={saving || row?.state !== "ready"}>
          {saving && <Loader2 className="h-4 w-4 animate-spin" />}
          {submitLabel}
        </Button>
      </div>
    </div>
  );
}
