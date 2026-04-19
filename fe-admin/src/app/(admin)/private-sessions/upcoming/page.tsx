"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { PageHeader } from "@/components/ui/page-header";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { useAdminState } from "@/lib/mock-state";
import { sessionDetailHref } from "@/lib/session-routes";
import clientsData from "@/data/clients.json";
import instructorsData from "@/data/instructors.json";
import locationsData from "@/data/locations.json";
import type { Client, Instructor, Location } from "@/types";

const TODAY = "2026-04-20";

type WhenFilter = "upcoming" | "past" | "all";

export default function PrivateUpcomingPage() {
  const state = useAdminState();
  const clients = clientsData as Client[];
  const instructors = instructorsData as Instructor[];
  const locations = locationsData as Location[];

  const [q, setQ] = useState("");
  const [when, setWhen] = useState<WhenFilter>("upcoming");

  const rows = useMemo(() => {
    const clientById = new Map(clients.map((c) => [c.id, c]));
    const instructorById = new Map(instructors.map((i) => [i.id, i]));
    const locationById = new Map(locations.map((l) => [l.id, l]));
    const needle = q.trim().toLowerCase();

    return state.sessions
      .filter((s) => s.type === "private")
      .filter((s) => {
        if (when === "upcoming" && s.date < TODAY) return false;
        if (when === "past" && s.date >= TODAY) return false;
        return true;
      })
      .map((s) => {
        const booking = state.bookings.find((b) => b.sessionId === s.id);
        const client = booking ? clientById.get(booking.clientId) ?? null : null;
        return {
          s,
          client,
          instructor: instructorById.get(s.instructorId) ?? null,
          location: s.locationId ? locationById.get(s.locationId) ?? null : null,
        };
      })
      .filter(({ s, client, instructor, location }) => {
        if (!needle) return true;
        const name = client ? `${client.firstName} ${client.lastName}` : "";
        const hay = `${name} ${instructor?.name ?? ""} ${location?.shortName ?? ""} ${s.name}`.toLowerCase();
        return hay.includes(needle);
      })
      .sort((a, b) => {
        const ad = `${a.s.date} ${a.s.time}`;
        const bd = `${b.s.date} ${b.s.time}`;
        return when === "past" ? bd.localeCompare(ad) : ad.localeCompare(bd);
      });
  }, [state.sessions, state.bookings, when, q, clients, instructors, locations]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Upcoming private sessions"
        description="Approved 1:1 bookings. Use Requests for pending approvals."
      />

      <div className="flex flex-wrap items-center gap-3">
        <Input
          placeholder="Search client, instructor, location"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="min-w-[240px] flex-1"
        />
        <div className="inline-flex rounded-lg border border-ink/10 bg-white p-0.5 text-sm">
          {(["upcoming", "past", "all"] as const).map((w) => (
            <button
              key={w}
              onClick={() => setWhen(w)}
              className={
                "rounded-md px-3 py-1 capitalize " +
                (when === w ? "bg-accent text-white" : "text-ink/70 hover:text-ink")
              }
            >
              {w}
            </button>
          ))}
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-ink/10 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-paper/60 text-left text-[11px] font-semibold uppercase tracking-wide text-ink/60">
            <tr>
              <th className="px-4 py-2">Date · Time</th>
              <th className="px-4 py-2">Client</th>
              <th className="px-4 py-2">Instructor</th>
              <th className="px-4 py-2">Location</th>
              <th className="px-4 py-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ s, client, instructor, location }) => (
              <tr key={s.id} className="border-t border-ink/5 hover:bg-paper/30">
                <td className="px-4 py-3 font-mono text-ink/70">
                  <div>{s.date}</div>
                  <div className="text-xs text-ink/50">{s.time}</div>
                </td>
                <td className="px-4 py-3">
                  <Link href={sessionDetailHref(s)} className="font-medium text-ink hover:text-accent">
                    {client ? `${client.firstName} ${client.lastName}` : s.name}
                  </Link>
                </td>
                <td className="px-4 py-3 text-ink/70">{instructor?.name ?? "—"}</td>
                <td className="px-4 py-3 text-ink/70">{location?.shortName ?? "—"}</td>
                <td className="px-4 py-3">
                  <Badge
                    tone={
                      s.status === "cancelled"
                        ? "error"
                        : s.status === "completed"
                          ? "neutral"
                          : "sage"
                    }
                  >
                    {s.status}
                  </Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && (
          <div className="p-8 text-center text-sm text-ink/50">No sessions match.</div>
        )}
      </div>
    </div>
  );
}
