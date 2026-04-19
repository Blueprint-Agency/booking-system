"use client";

import { use, useState } from "react";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { RosterTable } from "@/components/session/roster-table";
import { ManualBookModal } from "@/components/session/manual-book-modal";
import { CancelSessionModal } from "@/components/schedule/cancel-session-modal";
import { useAdminState, swapSessionInstructor } from "@/lib/mock-state";
import { sessionDetailHref } from "@/lib/session-routes";
import clientsData from "@/data/clients.json";
import instructorsData from "@/data/instructors.json";
import locationsData from "@/data/locations.json";
import clientPackagesData from "@/data/client-packages.json";
import productsData from "@/data/products.json";
import type { Client, ClientPackage, Instructor, Location, Product } from "@/types";

export default function ClassSessionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const state = useAdminState();
  const session = state.sessions.find((s) => s.id === id);
  const [bookOpen, setBookOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);

  if (!session) return notFound();
  if (session.type !== "regular") redirect(sessionDetailHref(session));

  const clients = clientsData as Client[];
  const instructors = instructorsData as Instructor[];
  const locations = locationsData as Location[];
  const clientPackages = clientPackagesData as ClientPackage[];
  const products = productsData as Product[];

  const roster = state.bookings.filter((b) => b.sessionId === session.id);
  const instructor = instructors.find((i) => i.id === session.instructorId);
  const location = locations.find((l) => l.id === session.locationId);

  const statusTone: "sage" | "neutral" | "error" =
    session.status === "cancelled" ? "error" : session.status === "completed" ? "neutral" : "sage";

  return (
    <div className="space-y-6">
      <Link href="/classes/schedule" className="inline-flex items-center gap-1 text-sm text-ink/60 hover:text-ink">
        <ArrowLeft className="h-4 w-4" /> Back to class schedule
      </Link>

      <PageHeader
        title={session.name}
        description={`${session.date} · ${session.time} · ${session.duration} min · ${location?.shortName ?? "—"}`}
        actions={
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={() => setBookOpen(true)} disabled={session.status === "cancelled"}>
              Manual book
            </Button>
            <Button variant="danger" onClick={() => setCancelOpen(true)} disabled={session.status === "cancelled"}>
              Cancel session
            </Button>
          </div>
        }
      />

      <div className="grid grid-cols-4 gap-4">
        <Card className="px-5 py-4">
          <div className="text-xs uppercase tracking-wide text-ink/50">Status</div>
          <div className="mt-1">
            <Badge tone={statusTone}>{session.status}</Badge>
          </div>
        </Card>
        <Card className="px-5 py-4">
          <div className="text-xs uppercase tracking-wide text-ink/50">Attendance</div>
          <div className="mt-1 font-mono text-lg text-ink">
            {session.bookedCount}/{session.capacity}
          </div>
        </Card>
        <Card className="px-5 py-4">
          <div className="text-xs uppercase tracking-wide text-ink/50">Instructor</div>
          <div className="mt-1 text-sm font-medium text-ink">{instructor?.name ?? "—"}</div>
          <select
            className="mt-2 w-full rounded-md border border-ink/10 bg-white px-2 py-1 text-xs"
            value={session.instructorId}
            onChange={(e) => swapSessionInstructor(session.id, e.target.value)}
            disabled={session.status === "cancelled"}
          >
            {instructors.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name}
              </option>
            ))}
          </select>
        </Card>
        <Card className="px-5 py-4">
          <div className="text-xs uppercase tracking-wide text-ink/50">Waitlist</div>
          <div className="mt-1 font-mono text-lg text-ink">{session.waitlistCount}</div>
        </Card>
      </div>

      <div>
        <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-ink/70">Roster</h3>
        <RosterTable
          bookings={roster}
          clients={clients}
          clientPackages={clientPackages}
          products={products}
        />
      </div>

      <ManualBookModal
        sessionId={session.id}
        clients={clients}
        open={bookOpen}
        onClose={() => setBookOpen(false)}
      />
      <CancelSessionModal
        session={session}
        open={cancelOpen}
        onClose={() => setCancelOpen(false)}
      />
    </div>
  );
}
