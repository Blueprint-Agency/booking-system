"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  AlertCircle,
  ArrowRight,
  CalendarX,
  Check,
  CheckCircle2,
  ExternalLink,
  Info,
  KeyRound,
  Loader2,
  QrCode,
  RefreshCw,
  ScanLine,
  Search,
  Undo2,
  Users,
} from "lucide-react";
import { Avatar, Badge, Button, EmptyState, Input, Label, PageHeader } from "@/components/ui";
import { QrScanner } from "@/components/check-in/qr-scanner";
import { ApiError } from "@/lib/api";
import {
  checkInBase,
  checkInErrorMessage,
  createScanGate,
  nowLineIndex,
  pickActiveSession,
  rosterRowMatches,
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
import { untickConfirmCopy } from "@/lib/untick-confirm";
import { useWorkspace } from "@/lib/workspace-context";

/**
 * The check-in desk (#192) — one component for both audiences. The admin desk
 * sees every session today at the workspace switcher's location; the
 * instructor desk the sessions they teach. That difference is the backend's
 * (the instructor mount refuses anyone else's booking), so here `audience`
 * only picks the endpoint and whether a member's name opens their profile.
 *
 * Two views. **Scan** is the door: the camera stays armed, the code box is the
 * fallback, and the banner says what the last scan did in the server's own
 * words. **Rosters** is today's sessions down the side and the picked one's
 * members beside it, to tick someone in by hand. Both stay mounted, so a
 * scan's roster and a half-typed search survive a switch; only the camera
 * closes while Rosters is up (it re-opens itself on the way back).
 */

/** A roster that another desk is also ticking drifts; re-read it this often. */
const ROSTER_REFRESH_MS = 60_000;
/** The clock that moves "ongoing" / "next" along without a reload. */
const CLOCK_TICK_MS = 30_000;
/** A roster longer than this gets a search box. */
const SEARCH_FROM_ROWS = 8;

type View = "scan" | "rosters";

type Banner =
  | {
      tone: "success" | "info";
      outcome: ScanResult["outcome"];
      title: string;
      detail: string;
      at: number;
      /** The scanned session, so Open roster shows it even after another is picked. */
      sessionKey: string;
    }
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

function attendedCount(s: CheckInSession) {
  return s.roster.filter((r) => r.check_in_state === "attended").length;
}

function scanBanner(res: ScanResult): Banner {
  const where = res.session.location?.name;
  const detail = [res.session.name, formatTime(res.session.starts_at), where].filter(Boolean).join(" · ");
  const key = sessionKey(res.session);
  return res.outcome === "checked_in"
    ? {
        tone: "success",
        outcome: res.outcome,
        title: `${res.member.name} is checked in`,
        detail,
        at: Date.now(),
        sessionKey: key,
      }
    : {
        tone: "info",
        outcome: res.outcome,
        title: `${res.member.name} was already checked in`,
        detail: res.message || detail,
        at: Date.now(),
        sessionKey: key,
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
  const { api, accessibleLocations, activeLocationId } = useWorkspace();
  const base = checkInBase(audience);

  // The admin desk follows the workspace switcher's location (the one filter
  // at the top of the portal); an instructor's desk is already narrowed to
  // their own sessions.
  const locationId = audience === "admin" && accessibleLocations.length > 1 ? activeLocationId : null;

  const [view, setView] = useState<View>("scan");
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
  // reload (the Refresh button), never from inside here.
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

  // The session at the door right now — the one running, else the next.
  const currentKey = pickActiveSession(sessions, now);
  const current = sessions.find((s) => sessionKey(s) === currentKey) ?? null;
  // What Rosters shows: whatever was picked (or last scanned), else the current one.
  const selectedKey =
    pickedKey && sessions.some((s) => sessionKey(s) === pickedKey) ? pickedKey : currentKey;
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

  const openRoster = (key: string | null) => {
    if (key) setPickedKey(key);
    setRosterError(null);
    setView("rosters");
  };

  const description =
    audience === "admin"
      ? "Scan a member's QR code or type their booking code. Rosters has today's sessions, to tick someone in by hand."
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

      <ViewSwitch view={view} onChange={setView} sessionCount={day ? sessions.length : null} />

      <div
        id="check-in-panel-scan"
        role="tabpanel"
        aria-labelledby="check-in-tab-scan"
        hidden={view !== "scan"}
        className="mt-5"
      >
        <div className="mx-auto max-w-5xl space-y-4">
          <ResultBanner
            banner={banner}
            scanning={scanning}
            onOpenRoster={
              // Only a session on today's list has a roster here: a code can find
              // one at another location, which this desk does not list.
              banner && banner.tone !== "error" && sessions.some((s) => sessionKey(s) === banner.sessionKey)
                ? () => openRoster(banner.sessionKey)
                : undefined
            }
          />

          <div className="grid gap-4 md:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
            <section className="rounded-xl border border-border bg-card p-4 shadow-soft sm:p-5">
              <div className="mb-3 flex items-center gap-2">
                <QrCode className="h-4 w-4 text-muted" />
                <h2 className="text-sm font-semibold text-ink">Scan QR code</h2>
              </div>
              {/* Unmounted while Rosters is up, so a hidden camera never checks anyone in unseen. */}
              {view === "scan" && <QrScanner onToken={onQrToken} />}
            </section>

            <div className="flex min-w-0 flex-col gap-4">
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
                    className="h-12 font-mono text-base uppercase tracking-wider"
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

              {current && (
                <AtTheDoor session={current} now={now} onOpen={() => openRoster(sessionKey(current))} />
              )}
            </div>
          </div>
        </div>
      </div>

      <div
        id="check-in-panel-rosters"
        role="tabpanel"
        aria-labelledby="check-in-tab-rosters"
        hidden={view !== "rosters"}
        className="mt-5"
      >
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
          <div className="grid items-start gap-4 md:grid-cols-[minmax(0,300px)_minmax(0,1fr)] lg:gap-6">
            <SessionRail
              day={day}
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
                key={selectedKey}
                audience={audience}
                session={selected}
                phase={sessionPhase(selected, now)}
                busyBookingId={busyBookingId}
                error={rosterError}
                onMark={(row, attended) => void mark(row, attended)}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function ViewSwitch({
  view,
  onChange,
  sessionCount,
}: {
  view: View;
  onChange: (v: View) => void;
  sessionCount: number | null;
}) {
  const tabs: { value: View; label: string; icon: typeof ScanLine; count?: number | null }[] = [
    { value: "scan", label: "Scan", icon: ScanLine },
    { value: "rosters", label: "Rosters", icon: Users, count: sessionCount },
  ];
  return (
    <div
      role="tablist"
      aria-label="Check-in view"
      className="inline-flex rounded-lg border border-border bg-card p-1 shadow-soft"
      onKeyDown={(e) => {
        if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
        e.preventDefault();
        const next = view === "scan" ? "rosters" : "scan";
        onChange(next);
        document.getElementById(`check-in-tab-${next}`)?.focus();
      }}
    >
      {tabs.map((t) => {
        const active = t.value === view;
        const Icon = t.icon;
        return (
          <button
            key={t.value}
            type="button"
            role="tab"
            id={`check-in-tab-${t.value}`}
            aria-selected={active}
            aria-controls={`check-in-panel-${t.value}`}
            tabIndex={active ? 0 : -1}
            data-testid={`check-in-view-${t.value}`}
            onClick={() => onChange(t.value)}
            className={`flex min-h-10 items-center gap-2 rounded-md px-4 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ${
              active ? "bg-accent text-white" : "text-muted hover:text-ink"
            }`}
          >
            <Icon className="h-4 w-4" />
            {t.label}
            {t.count != null && (
              <span
                className={`rounded-full px-1.5 text-xs tabular-nums ${
                  active ? "bg-white/20 text-white" : "bg-warm text-ink"
                }`}
              >
                {t.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

function ResultBanner({
  banner,
  scanning,
  onOpenRoster,
}: {
  banner: Banner | null;
  scanning: boolean;
  onOpenRoster?: () => void;
}) {
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
      className={`min-h-[88px] rounded-xl border p-4 shadow-soft sm:p-5 ${styles}`}
    >
      <div key={banner?.at ?? 0} className="flex items-center gap-4 animate-fade-in">
        {scanning ? (
          <Loader2 className="h-8 w-8 shrink-0 animate-spin text-muted" />
        ) : (
          <Icon className="h-8 w-8 shrink-0" />
        )}
        <div className="min-w-0 flex-1">
          {banner ? (
            <>
              <p className="text-lg font-semibold break-words">{banner.title}</p>
              <p className="mt-0.5 text-sm break-words text-ink/80">{banner.detail}</p>
            </>
          ) : (
            <p className="text-base">{scanning ? "Checking…" : "Ready. Scan a QR code or type a booking code."}</p>
          )}
        </div>
        {onOpenRoster && !scanning && (
          <Button type="button" variant="secondary" size="sm" className="shrink-0" onClick={onOpenRoster}>
            Open roster <ArrowRight className="h-4 w-4" />
          </Button>
        )}
      </div>
    </div>
  );
}

/** The session members are arriving for, under the code box: how full the door is, one tap from its roster. */
function AtTheDoor({ session, now, onOpen }: { session: CheckInSession; now: Date; onOpen: () => void }) {
  const phase = PHASE_BADGE[sessionPhase(session, now)];
  const attended = attendedCount(session);
  return (
    <section className="rounded-xl border border-border bg-card p-4 shadow-soft sm:p-5" aria-label="At the door now">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted">At the door</h2>
        <Badge tone={phase.tone}>{phase.label}</Badge>
      </div>
      <p className="truncate font-medium text-ink">{session.name}</p>
      <p className="truncate text-xs text-muted">
        {sessionLine(session)}
        {session.instructor ? ` · ${session.instructor.name}` : ""}
      </p>
      <Progress attended={attended} total={session.roster.length} className="mt-3" />
      <Button type="button" variant="ghost" size="sm" className="mt-3 -ml-2" onClick={onOpen}>
        Open roster <ArrowRight className="h-4 w-4" />
      </Button>
    </section>
  );
}

function Progress({ attended, total, className = "" }: { attended: number; total: number; className?: string }) {
  const pct = total === 0 ? 0 : Math.round((attended / total) * 100);
  return (
    <div className={className}>
      <div className="mb-1 flex items-baseline justify-between text-xs text-muted">
        <span>
          <span className="font-semibold tabular-nums text-ink">{attended}</span> of{" "}
          <span className="tabular-nums">{total}</span> checked in
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-warm" aria-hidden="true">
        <div className="h-full rounded-full bg-sage transition-[width]" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

/**
 * Today's sessions as one line each, in start order, with a "now" line
 * between the ones that have started and the ones still to come. A phone
 * swipes through them in one strip so the roster sits right under it.
 */
function SessionRail({
  day,
  sessions,
  selectedKey,
  now,
  onPick,
}: {
  day: CheckInDay | null;
  sessions: CheckInSession[];
  selectedKey: string | null;
  now: Date;
  onPick: (key: string) => void;
}) {
  const nowAt = nowLineIndex(sessions, now);
  // A location on every line only says something when the day spans more than one.
  const manyLocations = new Set(sessions.map((s) => s.location?.id ?? "")).size > 1;
  return (
    <nav
      aria-label="Today's sessions"
      className="min-w-0 md:sticky md:top-4 md:rounded-xl md:border md:border-border md:bg-card md:shadow-soft"
    >
      <div className="mb-2 md:mb-0 md:border-b md:border-border md:px-4 md:py-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted">
          {day ? `Today · ${formatDate(`${day.date}T00:00:00`)}` : "Today"}
        </h2>
        {day && (
          <p className="mt-0.5 text-xs text-muted">
            Check-in opens {day.opens_minutes_before} min before each start.
          </p>
        )}
      </div>
      <ul className="-mx-4 flex snap-x snap-mandatory gap-2 overflow-x-auto px-4 pb-1 md:mx-0 md:block md:max-h-[calc(100vh-14rem)] md:snap-none md:space-y-0 md:overflow-y-auto md:p-1.5">
        {sessions.map((s, i) => {
          const key = sessionKey(s);
          return (
            <SessionRailItem
              key={key}
              session={s}
              phase={sessionPhase(s, now)}
              active={key === selectedKey}
              showLocation={manyLocations}
              nowLine={i === nowAt ? now : null}
              onPick={() => onPick(key)}
            />
          );
        })}
        {nowAt === sessions.length && <NowLine now={now} />}
      </ul>
    </nav>
  );
}

function NowLine({ now }: { now: Date }) {
  return (
    <li role="presentation" className="hidden items-center gap-2 px-2 py-1 md:flex" data-testid="check-in-now-line">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-error tabular-nums">
        Now {formatTime(now.toISOString())}
      </span>
      <span className="h-px flex-1 bg-error/50" />
    </li>
  );
}

function SessionRailItem({
  session: s,
  phase,
  active,
  showLocation,
  nowLine,
  onPick,
}: {
  session: CheckInSession;
  phase: SessionPhase;
  active: boolean;
  showLocation: boolean;
  nowLine: Date | null;
  onPick: () => void;
}) {
  const attended = attendedCount(s);
  const total = s.roster.length;
  const waiting = s.waitlist?.length ?? 0;
  const ended = phase === "ended";
  const live = phase === "open" || phase === "ongoing";
  const meta = [s.instructor?.name, showLocation ? s.location?.name : null].filter(Boolean).join(" · ");
  return (
    <>
      {nowLine && <NowLine now={nowLine} />}
      <li className="w-[72%] shrink-0 snap-start md:w-auto">
        <button
          type="button"
          onClick={onPick}
          aria-pressed={active}
          aria-current={active ? "true" : undefined}
          data-testid="check-in-session"
          data-session-id={s.id}
          className={`relative flex h-full w-full min-w-0 items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 md:border-transparent ${
            active
              ? "border-accent bg-accent/5 md:border-transparent"
              : "border-border bg-card hover:bg-paper md:bg-transparent"
          } ${ended && !active ? "opacity-60" : ""}`}
        >
          {active && (
            <span aria-hidden="true" className="absolute inset-y-2 left-0 hidden w-0.5 rounded-full bg-accent md:block" />
          )}
          <span className="w-14 shrink-0 tabular-nums">
            <span className="block text-sm font-semibold text-ink">{formatTime(s.starts_at)}</span>
            <span className="block text-[11px] text-muted">{formatTime(s.ends_at)}</span>
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1.5">
              {live && (
                <span
                  aria-hidden="true"
                  className={`h-1.5 w-1.5 shrink-0 rounded-full ${phase === "ongoing" ? "bg-warning" : "bg-accent"}`}
                />
              )}
              <span className={`truncate text-sm ${active ? "font-semibold text-accent" : "font-medium text-ink"}`}>
                {s.name}
              </span>
              {s.kind === "pt" && (
                <Badge tone="accent" className="px-1.5 py-0 text-[10px]">
                  Private
                </Badge>
              )}
            </span>
            {meta && <span className="block truncate text-xs text-muted">{meta}</span>}
            {live && <span className="sr-only">{PHASE_BADGE[phase].label}</span>}
          </span>
          <span className="shrink-0 text-right tabular-nums">
            <span
              className={`block text-sm ${
                total > 0 && attended === total ? "font-semibold text-sage" : "text-ink"
              }`}
              aria-label={`${attended} of ${total} checked in`}
            >
              {attended}/{total}
            </span>
            {waiting > 0 && <span className="block text-[11px] font-medium text-warning">+{waiting} wait</span>}
          </span>
        </button>
      </li>
    </>
  );
}

function Roster({
  audience,
  session,
  phase,
  busyBookingId,
  error,
  onMark,
}: {
  audience: CheckInAudience;
  session: CheckInSession;
  phase: SessionPhase;
  busyBookingId: string | null;
  error: string | null;
  onMark: (row: CheckInRosterRow, attended: boolean) => void;
}) {
  const [query, setQuery] = useState("");
  const rows = [...session.roster].sort((a, b) => a.name.localeCompare(b.name));
  const shown = rows.filter((r) => rosterRowMatches(r, query));
  const attended = rows.filter((r) => r.check_in_state === "attended").length;
  const notOpen = phase === "not_open";
  const badge = PHASE_BADGE[phase];
  const where = [session.room?.name, session.location?.name].filter(Boolean).join(", ");
  // The admin desk opens a member's profile in a new tab, so the desk keeps its place.
  const profileHref = audience === "admin" ? (clientId: string) => `/admin/customers/${clientId}` : null;

  return (
    <section
      className="min-w-0 rounded-xl border border-border bg-card shadow-soft"
      aria-label={`Roster for ${session.name}`}
      data-testid="check-in-roster"
    >
      <header className="flex flex-col gap-4 border-b border-border px-4 py-4 sm:flex-row sm:items-start sm:justify-between sm:px-5">
        <div className="min-w-0">
          <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
            <Badge tone={session.kind === "class" ? "cyan" : "accent"}>
              {session.kind === "class" ? "Class" : "Private"}
            </Badge>
            <Badge tone={badge.tone}>{badge.label}</Badge>
          </div>
          <h3 className="break-words text-lg font-semibold text-ink">{session.name}</h3>
          <p className="mt-0.5 text-sm text-muted">
            {sessionLine(session)}
            {session.instructor ? ` · ${session.instructor.name}` : ""}
            {where ? ` · ${where}` : ""}
          </p>
        </div>
        <Progress attended={attended} total={rows.length} className="w-full shrink-0 sm:w-44" />
      </header>

      {notOpen && (
        <p className="mx-4 mt-3 rounded-md bg-paper px-3 py-2 text-xs text-muted sm:mx-5">
          Check-in opens at {formatTime(session.check_in_opens_at)}.
        </p>
      )}
      {error && (
        <p
          role="alert"
          data-testid="check-in-roster-error"
          className="mx-4 mt-3 rounded-md border border-error/30 bg-error/5 px-3 py-2 text-sm text-error sm:mx-5"
        >
          {error}
        </p>
      )}

      {rows.length > SEARCH_FROM_ROWS && (
        <div className="relative mx-4 mt-3 sm:mx-5">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <Input
            type="search"
            aria-label={`Find someone in ${session.name}`}
            placeholder="Find by name or code"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="h-10 pl-9"
          />
        </div>
      )}

      {rows.length === 0 ? (
        <p className="px-5 py-10 text-center text-sm text-muted">No one is booked into this session.</p>
      ) : shown.length === 0 ? (
        <p className="px-5 py-10 text-center text-sm text-muted">No one here matches &ldquo;{query.trim()}&rdquo;.</p>
      ) : (
        <ul className="mt-2 divide-y divide-border">
          {shown.map((r) => (
            <RosterRow
              key={r.booking_id}
              row={r}
              href={profileHref?.(r.client_id) ?? null}
              busy={busyBookingId === r.booking_id}
              locked={busyBookingId !== null || notOpen}
              onMark={onMark}
            />
          ))}
        </ul>
      )}
      <WaitingLine audience={audience} session={session} profileHref={profileHref} />
    </section>
  );
}

/** A member's name, opening their profile in a new tab where the desk may see it. */
function MemberName({
  name,
  href,
  children,
  className = "",
}: {
  name: string;
  href: string | null;
  children: React.ReactNode;
  className?: string;
}) {
  if (!href) return <div className={className}>{children}</div>;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`${name} — open profile in a new tab`}
      data-testid="check-in-member-link"
      className={`group rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ${className}`}
    >
      {children}
    </a>
  );
}

/**
 * Who is still waiting for a seat, in queue order, so the door can tell a
 * waitlisted member who turns up that they aren't booked yet. Giving them a
 * seat is the class page's Add to class, one tap away — offered only to staff
 * who may work the line (Manage rosters; an admin always may).
 */
function WaitingLine({
  audience,
  session,
  profileHref,
}: {
  audience: CheckInAudience;
  session: CheckInSession;
  profileHref: ((clientId: string) => string) | null;
}) {
  const { may } = useWorkspace();
  const line = session.waitlist ?? [];
  if (session.kind !== "class" || line.length === 0) return null;
  const classPage =
    audience === "admin"
      ? `/admin/schedule/class/${session.id}`
      : `/instructor/schedule/class/${session.id}`;
  return (
    <div
      className="border-t border-dashed border-border bg-paper/60 px-4 py-3 sm:px-5"
      aria-label={`Waitlist for ${session.name}`}
      role="region"
      data-testid="check-in-waitlist"
    >
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-warning">
          Waitlist · {line.length} not booked yet
        </h4>
        {may("manage_rosters") && (
          <Link href={classPage} className="text-xs font-medium text-accent hover:underline">
            Add to class on the class page
          </Link>
        )}
      </div>
      <ol className="space-y-1.5">
        {line.map((w) => (
          <li key={w.entry_id} className="flex items-center gap-3 text-sm">
            <span className="w-6 shrink-0 text-right text-xs font-semibold tabular-nums text-muted">
              #{w.position}
            </span>
            <MemberName name={w.name} href={profileHref?.(w.client_id) ?? null} className="min-w-0">
              <span className="block truncate text-ink group-hover:text-accent group-hover:underline">
                {w.name}
              </span>
            </MemberName>
            <Badge tone="warning" className="ml-auto">
              Waiting
            </Badge>
          </li>
        ))}
      </ol>
    </div>
  );
}

function RosterRow({
  row,
  href,
  busy,
  locked,
  onMark,
}: {
  row: CheckInRosterRow;
  href: string | null;
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
      className={`flex items-center gap-3 px-4 py-3 transition-colors sm:px-5 ${
        state === "attended" ? "bg-sage/5" : ""
      }`}
    >
      <MemberName name={row.name} href={href} className="flex min-w-0 flex-1 items-center gap-3">
        <Avatar name={row.name} size={36} className="hidden min-[400px]:flex" />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-1.5">
            <span className="truncate text-sm font-medium text-ink group-hover:text-accent group-hover:underline">
              {row.name}
            </span>
            {href && (
              <ExternalLink
                aria-hidden="true"
                className="h-3.5 w-3.5 shrink-0 text-muted opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
              />
            )}
          </div>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
            <span className="font-mono">{row.code}</span>
            {row.promoted_from_waitlist && <Badge tone="cyan">Promoted from waitlist</Badge>}
            {row.seat === "buffer" && <Badge>Buffer</Badge>}
            {row.seat === "overbook" && <Badge tone="warning">Overbook</Badge>}
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
      </MemberName>
      {state === "attended" ? (
        <UndoButton row={row} busy={busy} locked={locked} onUndo={() => onMark(row, false)} />
      ) : state === "n_a" ? null : (
        <Button
          type="button"
          className="h-11 w-40 px-4"
          disabled={locked}
          onClick={() => onMark(row, true)}
          data-testid="check-in-tick"
          aria-label={`Mark ${row.name} as attended`}
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
          Mark as attended
        </Button>
      )}
    </li>
  );
}

/** How long "Undo?" waits for its second tap before settling back to Attended. */
const UNDO_ARMED_MS = 4000;

/**
 * An attended member's button. Unmarking takes two taps on the same spot:
 * the first turns "Attended" into "Undo?", the second sends it. Tapping
 * elsewhere, or waiting, leaves them attended.
 */
function UndoButton({
  row,
  busy,
  locked,
  onUndo,
}: {
  row: CheckInRosterRow;
  busy: boolean;
  locked: boolean;
  onUndo: () => void;
}) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = window.setTimeout(() => setArmed(false), UNDO_ARMED_MS);
    return () => window.clearTimeout(t);
  }, [armed]);

  const hintId = `undo-hint-${row.booking_id}`;
  return (
    <div className="relative shrink-0">
      <Button
        type="button"
        variant="secondary"
        className={`h-11 w-40 px-3 ${
          armed
            ? "border-error/40 bg-error/10 text-error hover:bg-error/15"
            : "border-sage/40 bg-sage/10 text-sage hover:bg-sage/15"
        }`}
        disabled={locked}
        onClick={() => {
          if (armed) {
            setArmed(false);
            onUndo();
          } else {
            setArmed(true);
          }
        }}
        onBlur={() => setArmed(false)}
        onKeyDown={(e) => {
          if (e.key === "Escape") setArmed(false);
        }}
        data-testid="check-in-undo"
        data-armed={armed}
        aria-label={armed ? `Undo check-in for ${row.name}? Tap again to confirm` : `${row.name} is attended. Tap to undo`}
        aria-describedby={armed ? hintId : undefined}
      >
        {busy ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : armed ? (
          <Undo2 className="h-4 w-4" />
        ) : (
          <Check className="h-4 w-4" />
        )}
        {armed ? "Undo?" : "Attended"}
      </Button>
      {armed && (
        <p
          id={hintId}
          role="status"
          className="absolute right-0 top-full z-10 mt-1 w-56 rounded-md border border-border bg-card px-2.5 py-1.5 text-[11px] leading-snug text-muted shadow-soft animate-fade-in"
        >
          {untickConfirmCopy(row.name).body}
        </p>
      )}
    </div>
  );
}
