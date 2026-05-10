"use client";
import Link from "next/link";
import { useState, useMemo } from "react";
import { Search } from "lucide-react";
import { Avatar, Badge, Input, PageHeader } from "@/components/ui";
import { clients, clientPackages, bookings } from "@/data";
import { computeEventState } from "@/lib/event-state";
import { classInstances, workshops, ptSessions } from "@/data";
import { formatDate } from "@/lib/formatters";

type StatusFilter = "all" | "active" | "suspended";

export default function ClientsPage() {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");

  const stats = useMemo(() => {
    return clients.map((c) => {
      const activePkgs = clientPackages.filter(
        (p) =>
          p.clientId === c.id &&
          (p.creditsOrSessionsRemaining === null ||
            p.creditsOrSessionsRemaining > 0) &&
          (!p.expiresAt || new Date(p.expiresAt) > new Date("2026-05-10"))
      ).length;
      const upcoming = bookings.filter((b) => {
        if (b.clientId !== c.id || b.state !== "confirmed") return false;
        if (b.kind === "class" && b.classId) {
          const cls = classInstances.find((x) => x.id === b.classId);
          if (!cls) return false;
          return computeEventState({
            startsAt: cls.startsAt,
            endsAt: cls.endsAt,
            lifecycle: cls.lifecycle,
          }) === "scheduled";
        }
        if (b.kind === "workshop" && b.workshopId) {
          const w = workshops.find((x) => x.id === b.workshopId);
          if (!w) return false;
          return computeEventState({
            startsAt: w.startsAt,
            endsAt: w.endsAt,
            lifecycle: w.lifecycle,
          }) === "scheduled";
        }
        if (b.kind === "pt" && b.ptSessionId) {
          const s = ptSessions.find((x) => x.id === b.ptSessionId);
          if (!s) return false;
          return computeEventState({
            startsAt: s.startsAt,
            endsAt: s.endsAt,
            lifecycle: "active",
          }) === "scheduled";
        }
        return false;
      }).length;
      return { clientId: c.id, activePkgs, upcoming };
    });
  }, []);

  const filtered = clients.filter((c) => {
    if (status !== "all" && c.status !== status) return false;
    if (query.trim()) {
      const q = query.toLowerCase();
      return c.name.toLowerCase().includes(q) || c.email.toLowerCase().includes(q);
    }
    return true;
  });

  return (
    <div>
      <PageHeader
        title="Clients"
        description="Self-registered via the client app. List is read-only at this level — adjustments and status toggles live on the profile."
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <Input
            placeholder="Search by name or email…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="flex gap-1.5 text-xs">
          {(["all", "active", "suspended"] as StatusFilter[]).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setStatus(s)}
              className={`rounded-full px-3 py-1.5 font-medium capitalize transition ${
                status === s
                  ? "bg-accent text-white"
                  : "bg-card text-muted hover:bg-paper hover:text-ink"
              }`}
            >
              {s}
            </button>
          ))}
        </div>
        <span className="ml-auto text-xs text-muted">
          {filtered.length} of {clients.length}
        </span>
      </div>

      <div className="rounded-xl border border-border bg-card shadow-soft">
        <table className="w-full">
          <thead className="bg-paper">
            <tr className="text-left text-xs uppercase tracking-wider text-muted">
              <th className="px-5 py-3 font-medium">Client</th>
              <th className="px-5 py-3 font-medium">Joined</th>
              <th className="px-5 py-3 font-medium">Packages</th>
              <th className="px-5 py-3 font-medium">Upcoming</th>
              <th className="px-5 py-3 font-medium">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {filtered.map((c) => {
              const stat = stats.find((s) => s.clientId === c.id);
              return (
                <tr key={c.id} className="hover:bg-paper">
                  <td className="px-5 py-3">
                    <Link
                      href={`/admin/clients/${c.id}`}
                      className="flex items-center gap-3"
                    >
                      <Avatar name={c.name} size={32} />
                      <div>
                        <div className="font-medium text-ink">{c.name}</div>
                        <div className="text-xs text-muted">{c.email}</div>
                      </div>
                    </Link>
                  </td>
                  <td className="px-5 py-3 text-sm text-muted">{formatDate(c.joinedAt)}</td>
                  <td className="px-5 py-3 text-sm font-mono text-ink">
                    {stat?.activePkgs ?? 0}
                  </td>
                  <td className="px-5 py-3 text-sm font-mono text-ink">
                    {stat?.upcoming ?? 0}
                  </td>
                  <td className="px-5 py-3">
                    {c.status === "active" ? (
                      <Badge tone="sage">Active</Badge>
                    ) : (
                      <Badge tone="error">Suspended</Badge>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {filtered.length === 0 && (
          <div className="py-12 text-center text-sm text-muted">No clients match.</div>
        )}
      </div>
    </div>
  );
}
