"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  CalendarX,
  Check,
  CheckCircle2,
  Info,
  KeyRound,
  Loader2,
  QrCode,
  RefreshCw,
  Undo2,
} from "lucide-react";
import { Avatar, Badge, Button, EmptyState, Input, Label, PageHeader, Select } from "@/components/ui";
import { QrScanner } from "@/components/check-in/qr-scanner";
import { ApiError } from "@/lib/api";
import {
  checkInBase,
  checkInErrorMessage,
  createScanGate,
  pickActiveSession,
  sessionKey,
  sessionPhase,
  type CheckInAudience,
  type CheckInDay,
  type CheckInRosterRow,
  type CheckInSession,
  type CheckInState,
  type ScanResult,
  type SessionPhase,
} from "@/lib/check-in";
import { formatDate, formatTime } from "@/lib/formatters";
import { useWorkspace } from "@/lib/workspace-context";

/**
 * The check-in desk (#192) — one component for both audiences. The admin desk
 * sees every session today; the instructor desk the sessions they teach. That
 * difference is the backend's (the instructor mount refuses anyone else's
 * booking), so here `audience` only picks the endpoint and whether a location
 * filter is offered.
 *
 * Built to be held at the door: the camera stays armed, the code box is the
 * fallback, and the banner under them says what the last scan did in the
 * server's own words.
 */

/** A roster that another desk is also ticking drifts; re-read it this often. */
const ROSTER_REFRESH_MS = 60_000;
/** The clock that moves "ongoing" / "next" along without a reload. */
const CLOCK_TICK_MS = 30_000;
const ALL_LOCATIONS = "all";

type Banner =
  | { tone: "success" | "info"; outcome: ScanResult["outcome"]; title: string; detail: string; at: number }
  | { tone: "error"; outcome: string; title: string; detail: string; at: number };

const PHASE_BADGE: Record<SessionPhase, { label: string; tone: "neutral" | "accent" | "warning" | "sage" }> = {
  not_open: { label: "Later", tone: "neutral" },
  open: { label: "Check-in open", tone: "accent" },
  ongoing: { label: "Ongoing", tone: "warning" },
  ended: { label: "Ended", tone: "neutral" },
};

function sessionLine(s: Pick<CheckInSession, "starts_at" | "ends_at">) {
  return `${formatTime(s.starts_at)}–${formatTime(s.ends_at)}`;
}

function scanBanner(res: ScanResult): Banner {
  const where = res.session.location?.name;
  const detail = [res.session.name, formatTime(res.session.starts_at), where].filter(Boolean).join(" · ");
  return res.outcome === "checked_in"
    ? { tone: "success", outcome: res.outcome, title: `${res.member.name} is checked in`, detail, at: Date.now() }
    : {
        tone: "info",
        outcome: res.outcome,
        title: `${res.member.name} was already checked in`,
        detail: res.message || detail,
        at: Date.now(),
      };
}

function refusalBanner(err: unknown): Banner {
  const code =
    err instanceof ApiError ? ((err.body as { error?: string } | null)?.error ?? `http_${err.status}`) : "network";
  return {
    tone: "error",
    outcome: code,
    title: "Not checked in",
    detail: checkInErrorMessage(err, "Couldn't check in"),
    at: Date.now(),
  };
}

export function CheckInDesk({ audience }: { audience: CheckInAudience }) {
  const { api, accessibleLocations, activeLocationId, setActiveLocationId } = useWorkspace();
  const base = checkInBase(audience);

  // The admin desk follows the workspace switcher's location, with "all" on
  // top; an instructor's desk is already narrowed to their own sessions.
  const offerLocationFilter = audience === "admin" && accessibleLocations.length > 1;
  const [allLocations, setAllLocations] = useState(false);
  const locationId = offerLocationFilter && !allLocations ? activeLocationId : null;

  const [day, setDay] = useState<CheckInDay | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pickedKey, setPickedKey] = useState<string | null>(null);
  const [now, setNow] = useState(() => new Date());

  const [code, setCode] = useState("");
  const [scanning, setScanning] = useState(false);
  const scanningRef = useRef(false);
  const [banner, setBanner] = useState<Banner | null>(null);
  const gateRef = useRef(createScanGate());
  const codeRef = useRef<HTMLInputElement>(null);

  const [busyBookingId, setBusyBookingId] = useState<string | null>(null);
  const [rosterError, setRosterError] = useState<string | null>(null);

  // The latest request wins: a slow answer for the old location must not
  // overwrite the new one. `loading` is raised by whoever asks for a visible
  // reload (the Refresh button, a location change), never from inside here.
  const loadSeq = useRef(0);
  const load = useCallback(
    async (opts: { quiet?: boolean } = {}) => {
      if (!api) return;
      const seq = ++loadSeq.current;
      try {
        const res = await api.get<CheckInDay>(base, locationId ? { location_id: locationId } : undefined);
        if (seq !== loadSeq.current) return;
        setDay(res);
        setLoadError(null);
      } catch (err) {
        if (seq !== loadSeq.current) return;
        // A background refresh that fails keeps the roster on screen.
        if (!opts.quiet) setLoadError(checkInErrorMessage(err, "Couldn't load today's sessions"));
      } finally {
        if (seq === loadSeq.current) setLoading(false);
      }
    },
    [api, base, locationId],
  );

  // Subscribe to the backend: read now, then every minute. Both reads land in
  // timer callbacks, so this effect itself sets no state.
  useEffect(() => {
    const first = window.setTimeout(() => void load(), 0);
    const refresh = window.setInterval(() => void load({ quiet: true }), ROSTER_REFRESH_MS);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(refresh);
    };
  }, [load]);

  useEffect(() => {
    const clock = window.setInterval(() => setNow(new Date()), CLOCK_TICK_MS);
    return () => window.clearInterval(clock);
  }, []);

  const sessions = useMemo(
    () =>
      [...(day?.sessions ?? [])].sort(
        (a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime(),
      ),
    [day],
  );

  // What the desk shows: whatever was picked (or last scanned), else the
  // session running now / next — so the right roster is up without a tap.
  const selectedKey =
    pickedKey && sessions.some((s) => sessionKey(s) === pickedKey)
      ? pickedKey
      : pickActiveSession(sessions, now);
  const selected = sessions.find((s) => sessionKey(s) === selectedKey) ?? null;

  const submitScan = useCallback(
    async (body: { qr_token: string } | { code: string }) => {
      if (!api || scanningRef.current) return false;
      scanningRef.current = true;
      setScanning(true);
      try {
        const res = await api.post<ScanResult>(`${base}/scan`, body);
        setBanner(scanBanner(res));
        setPickedKey(sessionKey(res.session));
        void load({ quiet: true });
        return true;
      } catch (err) {
        setBanner(refusalBanner(err));
        return false;
      } finally {
        scanningRef.current = false;
        setScanning(false);
      }
    },
    [api, base, load],
  );

  const onQrToken = useCallback(
    (token: string) => {
      if (!token || scanningRef.current) return;
      if (!gateRef.current.admit(token, Date.now())) return;
      void submitScan({ qr_token: token });
    },
    [submitScan],
  );

  async function onCodeSubmit(e: React.FormEvent) {
    e.preventDefault();
    const typed = code.trim();
    if (!typed) {
      codeRef.current?.focus();
      return;
    }
    const ok = await submitScan({ code: typed });
    if (ok) setCode("");
    else codeRef.current?.select();
  }

  async function mark(row: CheckInRosterRow, attended: boolean) {
    if (!api || busyBookingId) return;
    setBusyBookingId(row.booking_id);
    setRosterError(null);
    try {
      const res = await api.post<{ check_in_state: CheckInState }>(`${base}/manual`, {
        booking_id: row.booking_id,
        attended,
      });
      setDay((prev) =>
        prev
          ? {
              ...prev,
              sessions: prev.sessions.map((s) => ({
                ...s,
                roster: s.roster.map((r) =>
                  r.booking_id === row.booking_id
                    ? {
                        ...r,
                        check_in_state: res.check_in_state,
                        method: attended ? "manual" : null,
                        checked_in_at: attended ? new Date().toISOString() : null,
                      }
                    : r,
                ),
              })),
            }
          : prev,
      );
      void load({ quiet: true });
    } catch (err) {
      setRosterError(
        `${row.name}: ${checkInErrorMessage(err, attended ? "Couldn't check in" : "Couldn't undo the check-in")}`,
      );
    } finally {
      setBusyBookingId(null);
    }
  }

  const reload = () => {
    setLoading(true);
    void load();
  };

  const description =
    audience === "admin"
      ? "Scan a member's QR code or type their booking code. Today's rosters are below — tap to tick someone in by hand."
      : "Scan a member's QR code or type their booking code for the sessions you teach today.";

  return (
    <div>
      <PageHeader
        title="Check-in"
        description={description}
        actions={
          <Button
            type="button"
            variant="secondary"
            onClick={reload}
            disabled={loading}
            aria-label="Refresh today's sessions"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh
          </Button>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,380px)]">
        {/* The door first on a phone: scanner, code box and result above the rosters. */}
        <aside className="order-first min-w-0 space-y-4 lg:order-none lg:col-start-2 lg:row-start-1">
          <ResultBanner banner={banner} scanning={scanning} />

          <section className="rounded-xl border border-border bg-card p-4 shadow-soft sm:p-5">
            <div className="mb-3 flex items-center gap-2">
              <QrCode className="h-4 w-4 text-muted" />
              <h2 className="text-sm font-semibold text-ink">Scan QR code</h2>
            </div>
            <QrScanner onToken={onQrToken} />
          </section>

          <section className="rounded-xl border border-border bg-card p-4 shadow-soft sm:p-5">
            <div className="mb-3 flex items-center gap-2">
              <KeyRound className="h-4 w-4 text-muted" />
              <h2 className="text-sm font-semibold text-ink">Type a booking code</h2>
            </div>
            <form className="space-y-3" onSubmit={onCodeSubmit} noValidate>
              <Label htmlFor="check-in-code" className="sr-only">
                Booking code
              </Label>
              <Input
                id="check-in-code"
                ref={codeRef}
                data-testid="check-in-code-input"
                aria-label="Booking code"
                placeholder="RT-XXXXXX"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="characters"
                spellCheck={false}
                enterKeyHint="go"
                maxLength={40}
                className="h-12 text-base uppercase tracking-wider"
              />
              <Button
                type="submit"
                size="lg"
                className="w-full"
                disabled={scanning}
                data-testid="check-in-code-submit"
              >
                {scanning ? <Loader2 className="h-5 w-5 animate-spin" /> : <Check className="h-5 w-5" />}
                Check in
              </Button>
            </form>
            <p className="mt-3 text-xs text-muted">
              Codes aren&apos;t case-sensitive. The code finds the member and their session on its own.
            </p>
          </section>
        </aside>

        <section className="min-w-0 space-y-4 lg:col-start-1 lg:row-start-1">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div className="min-w-0">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-muted">
                {day ? `Today · ${formatDate(`${day.date}T00:00:00`)}` : "Today"}
              </h2>
              {day && (
                <p className="mt-0.5 text-xs text-muted">
                  Check-in opens {day.opens_minutes_before} min before each session starts.
                </p>
              )}
            </div>
            {offerLocationFilter && (
              <div className="w-full sm:w-56">
                <Label htmlFor="check-in-location" className="mb-1 block text-xs text-muted">
                  Location
                </Label>
                <Select
                  id="check-in-location"
                  data-testid="check-in-location"
                  className="h-11"
                  value={allLocations ? ALL_LOCATIONS : (activeLocationId ?? ALL_LOCATIONS)}
                  onChange={(e) => {
                    // The effect on `load` fetches the new location; this just shows it's coming.
                    setLoading(true);
                    if (e.target.value === ALL_LOCATIONS) {
                      setAllLocations(true);
                    } else {
                      setAllLocations(false);
                      setActiveLocationId(e.target.value);
                    }
                    setPickedKey(null);
                  }}
                >
                  <option value={ALL_LOCATIONS}>All locations</option>
                  {accessibleLocations.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </Select>
              </div>
            )}
          </div>

          {loading && !day ? (
            <div className="flex h-40 items-center justify-center gap-2 rounded-xl border border-border bg-card text-sm text-muted shadow-soft">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading today&apos;s sessions…
            </div>
          ) : loadError && !day ? (
            <div
              role="alert"
              className="rounded-xl border border-error/30 bg-error/5 p-6 text-center text-sm text-error"
            >
              <p>{loadError}</p>
              <Button size="sm" variant="ghost" onClick={reload} className="mt-2">
                Retry
              </Button>
            </div>
          ) : sessions.length === 0 ? (
            <div className="rounded-xl border border-border bg-card shadow-soft">
              <EmptyState
                icon={CalendarX}
                title="No sessions today"
                description={
                  audience === "admin"
                    ? "Nothing on the schedule here today. A scanned code still finds its own session."
                    : "You aren't teaching anything today."
                }
              />
            </div>
          ) : (
            <>
              <SessionPicker
                sessions={sessions}
                selectedKey={selectedKey}
                now={now}
                onPick={(key) => {
                  setPickedKey(key);
                  setRosterError(null);
                }}
              />
              {selected && (
                <Roster
                  session={selected}
                  phase={sessionPhase(selected, now)}
                  busyBookingId={busyBookingId}
                  error={rosterError}
                  onMark={mark}
                />
              )}
            </>
          )}
        </section>
      </div>
    </div>
  );
}

function ResultBanner({ banner, scanning }: { banner: Banner | null; scanning: boolean }) {
  const tone = banner?.tone;
  const styles =
    tone === "success"
      ? "border-sage/40 bg-sage/10 text-sage"
      : tone === "info"
        ? "border-accent/30 bg-accent/5 text-accent"
        : tone === "error"
          ? "border-error/40 bg-error/10 text-error"
          : "border-border bg-card text-muted";
  const Icon = tone === "success" ? CheckCircle2 : tone === "info" ? Info : tone === "error" ? AlertCircle : QrCode;
  // The live region stays mounted so screen readers announce each result; the
  // inner block is keyed per result so the same outcome twice still reads as new.
  return (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="true"
      data-testid="check-in-result"
      data-outcome={banner?.outcome ?? "none"}
      className={`min-h-[72px] rounded-xl border p-4 shadow-soft ${styles}`}
    >
      <div key={banner?.at ?? 0} className="flex items-start gap-3 animate-fade-in">
        {scanning ? (
          <Loader2 className="mt-0.5 h-6 w-6 shrink-0 animate-spin text-muted" />
        ) : (
          <Icon className="mt-0.5 h-6 w-6 shrink-0" />
        )}
        <div className="min-w-0">
          {banner ? (
            <>
              <p className="text-base font-semibold break-words">{banner.title}</p>
              <p className="mt-0.5 text-sm break-words text-ink/80">{banner.detail}</p>
            </>
          ) : (
            <p className="text-sm">{scanning ? "Checking…" : "Ready. Scan a QR code or type a booking code."}</p>
          )}
        </div>
      </div>
    </div>
  );
}

function SessionPicker({
  sessions,
  selectedKey,
  now,
  onPick,
}: {
  sessions: CheckInSession[];
  selectedKey: string | null;
  now: Date;
  onPick: (key: string) => void;
}) {
  return (
    <ul className="grid gap-2 sm:grid-cols-2" aria-label="Today's sessions">
      {sessions.map((s) => {
        const key = sessionKey(s);
        const phase = PHASE_BADGE[sessionPhase(s, now)];
        const attended = s.roster.filter((r) => r.check_in_state === "attended").length;
        const active = key === selectedKey;
        return (
          <li key={key} className="min-w-0">
            <button
              type="button"
              onClick={() => onPick(key)}
              aria-pressed={active}
              data-testid="check-in-session"
              data-session-id={s.id}
              className={`w-full min-w-0 rounded-xl border bg-card p-3 text-left shadow-soft transition sm:p-4 ${
                active ? "border-accent ring-2 ring-accent/20" : "border-border hover:border-accent/40"
              }`}
            >
              <div className="mb-1 flex flex-wrap items-center gap-1.5">
                <Badge tone={s.kind === "class" ? "cyan" : "accent"}>{s.kind === "class" ? "Class" : "Private"}</Badge>
                <Badge tone={phase.tone}>{phase.label}</Badge>
              </div>
              <div className="truncate font-medium text-ink">{s.name}</div>
              <div className="truncate text-xs text-muted">
                {sessionLine(s)}
                {s.instructor ? ` · ${s.instructor.name}` : ""}
                {s.location ? ` · ${s.location.name}` : ""}
              </div>
              <div className="mt-1 text-xs text-muted">
                {attended} / {s.roster.length} checked in
              </div>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function Roster({
  session,
  phase,
  busyBookingId,
  error,
  onMark,
}: {
  session: CheckInSession;
  phase: SessionPhase;
  busyBookingId: string | null;
  error: string | null;
  onMark: (row: CheckInRosterRow, attended: boolean) => void;
}) {
  const rows = [...session.roster].sort((a, b) => a.name.localeCompare(b.name));
  const attended = rows.filter((r) => r.check_in_state === "attended").length;
  const notOpen = phase === "not_open";
  const where = [session.room?.name, session.location?.name].filter(Boolean).join(", ");

  return (
    <section
      className="rounded-xl border border-border bg-card shadow-soft"
      aria-label={`Roster for ${session.name}`}
      data-testid="check-in-roster"
    >
      <header className="border-b border-border px-4 py-3 sm:px-5">
        <h3 className="text-sm font-semibold text-ink">
          {session.name} · {sessionLine(session)}
        </h3>
        <p className="mt-0.5 text-xs text-muted">
          {attended} / {rows.length} checked in
          {session.instructor ? ` · ${session.instructor.name}` : ""}
          {where ? ` · ${where}` : ""}
        </p>
        {notOpen && (
          <p className="mt-2 rounded-md bg-paper px-3 py-2 text-xs text-muted">
            Check-in opens at {formatTime(session.check_in_opens_at)}.
          </p>
        )}
      </header>
      {error && (
        <p
          role="alert"
          data-testid="check-in-roster-error"
          className="mx-4 mt-3 rounded-md border border-error/30 bg-error/5 px-3 py-2 text-sm text-error sm:mx-5"
        >
          {error}
        </p>
      )}
      {rows.length === 0 ? (
        <p className="px-5 py-8 text-center text-sm text-muted">No one is booked into this session.</p>
      ) : (
        <ul className="divide-y divide-border">
          {rows.map((r) => (
            <RosterRow
              key={r.booking_id}
              row={r}
              busy={busyBookingId === r.booking_id}
              locked={busyBookingId !== null || notOpen}
              onMark={onMark}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function RosterRow({
  row,
  busy,
  locked,
  onMark,
}: {
  row: CheckInRosterRow;
  busy: boolean;
  locked: boolean;
  onMark: (row: CheckInRosterRow, attended: boolean) => void;
}) {
  const state = row.check_in_state;
  return (
    <li
      data-testid="check-in-roster-row"
      data-booking-code={row.code}
      data-check-in-state={state}
      aria-label={`${row.name}, ${row.code}`}
      className="flex items-center gap-3 px-4 py-3 sm:px-5"
    >
      <Avatar name={row.name} size={36} className="hidden min-[400px]:flex" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-ink">{row.name}</div>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
          <span className="font-mono">{row.code}</span>
          {state === "attended" && (
            <Badge tone="sage">
              <Check className="mr-1 h-3 w-3" />
              {row.checked_in_at ? `In ${formatTime(row.checked_in_at)}` : "Attended"}
              {row.method && row.method !== "manual" ? ` · ${row.method.toUpperCase()}` : ""}
            </Badge>
          )}
          {state === "no_show" && <Badge tone="error">No-show</Badge>}
          {state === "pending" && <Badge>Not in yet</Badge>}
        </div>
      </div>
      {state === "attended" ? (
        <Button
          type="button"
          variant="secondary"
          className="h-11 px-3"
          disabled={locked}
          onClick={() => onMark(row, false)}
          data-testid="check-in-undo"
          aria-label={`Undo check-in for ${row.name}`}
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Undo2 className="h-4 w-4" />}
          Undo
        </Button>
      ) : state === "n_a" ? null : (
        <Button
          type="button"
          className="h-11 px-4"
          disabled={locked}
          onClick={() => onMark(row, true)}
          data-testid="check-in-tick"
          aria-label={`Check in ${row.name}`}
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
          Check in
        </Button>
      )}
    </li>
  );
}
