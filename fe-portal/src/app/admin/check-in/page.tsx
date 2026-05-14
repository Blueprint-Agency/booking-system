"use client";
import { useState, useMemo } from "react";
import { QrCode, KeyRound, Check, ScanLine, Camera } from "lucide-react";
import { Avatar, Badge, Button, Input, Label, PageHeader } from "@/components/ui";
import {
  classInstances,
  ptSessions,
  bookings as seedBookings,
  clients,
  classTypes,
  instructors,
} from "@/data";
import { computeEventState } from "@/lib/event-state";
import { formatDate, formatTime } from "@/lib/formatters";
import { useWorkspace } from "@/lib/workspace-context";
import type { Booking } from "@/types";

const NOW = new Date("2026-05-10T03:00:00.000Z"); // 11am SGT — same window as today's classes

export default function CheckInPage() {
  const { activeLocationId, activeLocation } = useWorkspace();
  const [bookings, setBookings] = useState<Booking[]>(seedBookings);
  const [code, setCode] = useState("");
  const [lastResult, setLastResult] = useState<{ ok: boolean; msg: string } | null>(null);

  // Build all "in window" sessions: ongoing or starting in next 90 min
  const activeSessions = useMemo(() => {
    if (!activeLocationId) return [];
    const ninetyMinAhead = new Date(NOW.getTime() + 90 * 60 * 1000);
    const cls = classInstances
      .filter((c) => c.locationId === activeLocationId)
      .map((c) => ({
        kind: "class" as const,
        id: c.id,
        startsAt: c.startsAt,
        endsAt: c.endsAt,
        instructorId: c.instructorId,
        classTypeId: c.classTypeId as string | null,
        eventState: computeEventState({
          startsAt: c.startsAt,
          endsAt: c.endsAt,
          lifecycle: c.lifecycle,
          now: NOW,
        }),
      }))
      .filter(
        (c) =>
          c.eventState === "ongoing" ||
          (c.eventState === "scheduled" && new Date(c.startsAt) <= ninetyMinAhead)
      );
    const pt = ptSessions
      .filter((s) => s.lifecycle === "active" && s.locationId === activeLocationId)
      .map((s) => ({
        kind: "pt" as const,
        id: s.id,
        startsAt: s.startsAt,
        endsAt: s.endsAt,
        instructorId: s.instructorId,
        classTypeId: null,
        eventState: computeEventState({
          startsAt: s.startsAt,
          endsAt: s.endsAt,
          lifecycle: "active",
          now: NOW,
        }),
      }))
      .filter(
        (s) =>
          s.eventState === "ongoing" ||
          (s.eventState === "scheduled" && new Date(s.startsAt) <= ninetyMinAhead)
      );
    return [...cls, ...pt].sort(
      (a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime()
    );
  }, [activeLocationId]);

  const [selectedKey, setSelectedKey] = useState<string>(
    activeSessions[0] ? `${activeSessions[0].kind}-${activeSessions[0].id}` : ""
  );

  const selected = activeSessions.find((s) => `${s.kind}-${s.id}` === selectedKey);
  const roster = selected
    ? bookings
        .filter((b) =>
          selected.kind === "class" ? b.classId === selected.id : b.ptSessionId === selected.id
        )
        .filter((b) => b.state === "confirmed")
        .map((b) => ({ booking: b, client: clients.find((c) => c.id === b.clientId)! }))
    : [];

  function flipCheckIn(bookingId: string, to: "attended" | "no_show") {
    setBookings((prev) =>
      prev.map((b) => (b.id === bookingId ? { ...b, checkInState: to } : b))
    );
  }

  function handleCodeSubmit(e: React.FormEvent) {
    e.preventDefault();
    const norm = code.trim().toUpperCase();
    if (!norm) return;
    const match = bookings.find((b) => b.code.toUpperCase() === norm && b.state === "confirmed");
    if (!match) {
      setLastResult({ ok: false, msg: `No booking found for code "${norm}".` });
      setCode("");
      return;
    }
    if (match.checkInState === "attended") {
      const c = clients.find((x) => x.id === match.clientId);
      setLastResult({ ok: false, msg: `${c?.name ?? "Client"} already checked in.` });
    } else {
      flipCheckIn(match.id, "attended");
      const c = clients.find((x) => x.id === match.clientId);
      setLastResult({ ok: true, msg: `${c?.name ?? "Client"} checked in.` });
    }
    setCode("");
  }

  return (
    <div>
      <PageHeader
        title="Check-in"
        description="Front-desk daily driver. Scan QR codes or type the booking code (YS-XXXXXX). Both resolve client + session in one lookup."
      />

      {activeLocation && (
        <div className="mb-4 text-xs text-muted">
          Checking in at <span className="font-medium text-ink">{activeLocation.name}</span>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <section className="space-y-3 lg:col-span-2">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted">
            Active sessions
          </h2>
          {activeSessions.length === 0 ? (
            <div className="rounded-xl border border-border bg-card px-5 py-10 text-center text-sm text-muted shadow-soft">
              No sessions in the next 90 minutes.
            </div>
          ) : (
            <div className="grid gap-2">
              {activeSessions.map((s) => {
                const key = `${s.kind}-${s.id}`;
                const ins = instructors.find((i) => i.id === s.instructorId);
                const ct = classTypes.find((c) => c.id === s.classTypeId);
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setSelectedKey(key)}
                    className={`rounded-xl border bg-card p-4 text-left shadow-soft transition ${
                      selectedKey === key
                        ? "border-accent ring-2 ring-accent/20"
                        : "border-border hover:border-accent/40"
                    }`}
                  >
                    <div className="mb-1 flex items-center gap-2">
                      <Badge tone={s.kind === "class" ? "cyan" : "accent"}>
                        {s.kind === "class" ? "Class" : "Private"}
                      </Badge>
                      {s.eventState === "ongoing" && <Badge tone="warning">Ongoing</Badge>}
                      {s.eventState === "scheduled" && <Badge tone="accent">Starts soon</Badge>}
                    </div>
                    <div className="font-medium text-ink">
                      {ct?.name ?? "Private session"}
                    </div>
                    <div className="text-xs text-muted">
                      {formatDate(s.startsAt)} · {formatTime(s.startsAt)} ·{" "}
                      {ins?.name.split(" ")[0]}
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          {selected && roster.length > 0 && (
            <div className="rounded-xl border border-border bg-card shadow-soft">
              <header className="border-b border-border px-5 py-3">
                <h3 className="text-sm font-semibold text-ink">
                  Roster — {roster.filter((r) => r.booking.checkInState === "attended").length} /{" "}
                  {roster.length} checked in
                </h3>
              </header>
              <ul className="divide-y divide-border">
                {roster.map(({ booking, client }) => (
                  <li key={booking.id} className="flex items-center gap-4 px-5 py-3">
                    <Avatar name={client.name} size={32} />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium text-ink">{client.name}</div>
                      <div className="font-mono text-xs text-muted">{booking.code}</div>
                    </div>
                    {booking.checkInState === "attended" ? (
                      <Badge tone="sage">
                        <Check className="mr-1 h-3 w-3" /> Attended
                      </Badge>
                    ) : booking.checkInState === "no_show" ? (
                      <Badge tone="error">No-show</Badge>
                    ) : (
                      <div className="flex gap-1.5">
                        <button
                          type="button"
                          onClick={() => flipCheckIn(booking.id, "attended")}
                          className="rounded-md border border-border bg-paper px-2 py-1 text-xs hover:bg-sage/10 hover:text-sage"
                        >
                          Attended
                        </button>
                        <button
                          type="button"
                          onClick={() => flipCheckIn(booking.id, "no_show")}
                          className="rounded-md border border-border bg-paper px-2 py-1 text-xs hover:bg-error/10 hover:text-error"
                        >
                          No-show
                        </button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>

        <aside className="space-y-3">
          <div className="rounded-xl border border-border bg-card p-5 shadow-soft">
            <div className="mb-3 flex items-center gap-2">
              <QrCode className="h-4 w-4 text-muted" />
              <h3 className="text-sm font-semibold text-ink">QR scan</h3>
            </div>
            <div className="flex aspect-square items-center justify-center rounded-lg border border-dashed border-border bg-paper text-muted">
              <div className="text-center text-xs">
                <ScanLine className="mx-auto mb-2 h-10 w-10" />
                Camera area
                <div className="mt-1 text-[11px]">html5-qrcode in production</div>
              </div>
            </div>
            <Button variant="secondary" className="mt-3 w-full" disabled>
              <Camera className="h-4 w-4" /> Start scan (mock)
            </Button>
          </div>

          <div className="rounded-xl border border-border bg-card p-5 shadow-soft">
            <div className="mb-3 flex items-center gap-2">
              <KeyRound className="h-4 w-4 text-muted" />
              <h3 className="text-sm font-semibold text-ink">Code entry</h3>
            </div>
            <form className="space-y-2" onSubmit={handleCodeSubmit}>
              <Label htmlFor="code-input" className="sr-only">
                Booking code
              </Label>
              <Input
                id="code-input"
                placeholder="YS-XXXXXX"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                className="font-mono uppercase"
              />
              <Button type="submit" className="w-full">
                Check in
              </Button>
            </form>
            {lastResult && (
              <div
                className={`mt-3 rounded-md px-3 py-2 text-xs ${
                  lastResult.ok
                    ? "bg-sage/10 text-sage"
                    : "bg-error/10 text-error"
                }`}
              >
                {lastResult.msg}
              </div>
            )}
            <div className="mt-3 text-[11px] text-muted">
              Codes are case-insensitive. The system resolves both client and session — no
              "wrong session" error possible.
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
