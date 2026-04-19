"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { PageHeader } from "@/components/ui/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AddWorkshopModal } from "@/components/schedule/add-workshop-modal";
import { useAdminState } from "@/lib/mock-state";
import instructorsData from "@/data/instructors.json";
import locationsData from "@/data/locations.json";
import tenantsData from "@/data/tenants.json";
import type { Instructor, Location, Tenant } from "@/types";

const TODAY = "2026-04-20";

type WhenFilter = "all" | "upcoming" | "past";

export default function WorkshopsListPage() {
  const state = useAdminState();
  const instructors = instructorsData as Instructor[];
  const locations = locationsData as Location[];
  const tenantId = (tenantsData as Tenant[])[0].id;

  const [q, setQ] = useState("");
  const [when, setWhen] = useState<WhenFilter>("upcoming");
  const [createOpen, setCreateOpen] = useState(false);

  const rows = useMemo(() => {
    const instructorById = new Map(instructors.map((i) => [i.id, i]));
    const locationById = new Map(locations.map((l) => [l.id, l]));
    const needle = q.trim().toLowerCase();

    return state.sessions
      .filter((s) => s.type === "workshop")
      .filter((s) => {
        if (when === "upcoming" && s.date < TODAY) return false;
        if (when === "past" && s.date >= TODAY) return false;
        if (!needle) return true;
        const instructor = instructorById.get(s.instructorId);
        const location = s.locationId ? locationById.get(s.locationId) ?? null : null;
        const hay = `${s.name} ${instructor?.name ?? ""} ${location?.shortName ?? ""}`.toLowerCase();
        return hay.includes(needle);
      })
      .map((s) => ({
        s,
        instructor: instructorById.get(s.instructorId) ?? null,
        location: s.locationId ? locationById.get(s.locationId) ?? null : null,
      }))
      .sort((a, b) => {
        const ad = `${a.s.date} ${a.s.time}`;
        const bd = `${b.s.date} ${b.s.time}`;
        return when === "past" ? bd.localeCompare(ad) : ad.localeCompare(bd);
      });
  }, [state.sessions, when, q, instructors, locations]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Workshops"
        description="Paid one-off events. Each row is a scheduled workshop session."
        actions={<Button onClick={() => setCreateOpen(true)}>Add workshop</Button>}
      />

      <div className="flex flex-wrap items-center gap-3">
        <Input
          placeholder="Search workshop, instructor, location"
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
              <th className="px-4 py-2">Workshop</th>
              <th className="px-4 py-2">Instructor</th>
              <th className="px-4 py-2">Location</th>
              <th className="px-4 py-2">Sold</th>
              <th className="px-4 py-2">Price</th>
              <th className="px-4 py-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ s, instructor, location }) => (
              <tr key={s.id} className="border-t border-ink/5 hover:bg-paper/30">
                <td className="px-4 py-3 font-mono text-ink/70">
                  <div>{s.date}</div>
                  <div className="text-xs text-ink/50">{s.time}</div>
                </td>
                <td className="px-4 py-3">
                  <Link href={`/workshops/${s.id}`} className="font-medium text-ink hover:text-accent">
                    {s.name}
                  </Link>
                </td>
                <td className="px-4 py-3 text-ink/70">{instructor?.name ?? "—"}</td>
                <td className="px-4 py-3 text-ink/70">{location?.shortName ?? "—"}</td>
                <td className="px-4 py-3 font-mono text-ink/70">
                  {s.bookedCount}/{s.capacity}
                </td>
                <td className="px-4 py-3 font-mono text-ink/70">
                  {s.price ? `S$${s.price}` : "—"}
                </td>
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
          <div className="p-8 text-center text-sm text-ink/50">No workshops match.</div>
        )}
      </div>

      <AddWorkshopModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        instructors={instructors}
        locations={locations}
        tenantId={tenantId}
      />
    </div>
  );
}
