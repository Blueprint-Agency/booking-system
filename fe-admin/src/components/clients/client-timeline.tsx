import type {
  Booking,
  CreditAdjustment,
  Session,
} from "@/types";

type Row = { when: string; label: string; detail?: string };

export function ClientTimeline({
  clientId,
  bookings,
  sessions,
  creditAdjustments,
}: {
  clientId: string;
  bookings: Booking[];
  sessions: Session[];
  creditAdjustments: CreditAdjustment[];
}) {
  const rows: Row[] = [];
  for (const b of bookings.filter((x) => x.clientId === clientId)) {
    const s = sessions.find((x) => x.id === b.sessionId);
    rows.push({
      when: b.createdAt,
      label: `Booking · ${s?.name ?? "Unknown"} (${b.status})`,
      detail: s ? `${s.date} ${s.time}` : undefined,
    });
  }
  for (const ca of creditAdjustments.filter((x) => x.clientId === clientId)) {
    rows.push({
      when: ca.createdAt,
      label: `Credit ${ca.delta > 0 ? "+" : ""}${ca.delta}`,
      detail: ca.reason,
    });
  }
  rows.sort((a, b) => (a.when < b.when ? 1 : -1));

  if (rows.length === 0) {
    return <div className="text-sm text-ink/50">No activity yet.</div>;
  }
  return (
    <ul className="space-y-3">
      {rows.slice(0, 50).map((r, i) => (
        <li key={i} className="flex gap-3">
          <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-accent" />
          <div>
            <div className="text-sm font-medium text-ink">{r.label}</div>
            {r.detail && <div className="text-xs text-ink/60">{r.detail}</div>}
            <div className="font-mono text-[11px] text-ink/40">{r.when}</div>
          </div>
        </li>
      ))}
    </ul>
  );
}
