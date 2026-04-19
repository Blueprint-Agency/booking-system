import type { Booking, Client, Session } from "@/types";

export function RecentCheckIns({
  bookings,
  clients,
  sessions,
}: {
  bookings: Booking[];
  clients: Client[];
  sessions: Session[];
}) {
  const recent = [...bookings]
    .filter((b) => b.checkInStatus === "attended")
    .slice(-20)
    .reverse();

  if (recent.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-ink/15 p-6 text-center text-sm text-ink/50">
        No check-ins yet.
      </div>
    );
  }
  return (
    <ul className="divide-y divide-ink/5 rounded-xl border border-ink/10 bg-white">
      {recent.map((b) => {
        const c = clients.find((x) => x.id === b.clientId);
        const s = sessions.find((x) => x.id === b.sessionId);
        return (
          <li key={b.id} className="flex items-center justify-between px-4 py-2 text-sm">
            <span className="font-medium text-ink">
              {c ? `${c.firstName} ${c.lastName}` : "Unknown"}
            </span>
            <span className="text-ink/60">{s?.name ?? "—"}</span>
            <span className="font-mono text-xs text-ink/50">{s?.time ?? ""}</span>
          </li>
        );
      })}
    </ul>
  );
}
