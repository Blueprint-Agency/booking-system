import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import {
  clients,
  clientPackages,
  manualAdjustments,
  bookings,
  cancellations,
  globalPolicy,
  classInstances,
  workshops,
  ptSessions,
} from "@/data";
import { ClientProfileClient } from "@/components/clients/client-profile-client";

export default async function ClientProfilePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const client = clients.find((c) => c.id === id);
  if (!client) notFound();

  const myPackages = clientPackages.filter((p) => p.clientId === id);
  const myAdjustments = manualAdjustments.filter((a) => a.clientId === id);
  const myBookings = bookings
    .filter((b) => b.clientId === id)
    .map((b) => {
      let label = "";
      let dateIso = "";
      if (b.classId) {
        const c = classInstances.find((x) => x.id === b.classId);
        if (c) {
          dateIso = c.startsAt;
          label = "Class";
        }
      } else if (b.workshopId) {
        const w = workshops.find((x) => x.id === b.workshopId);
        if (w && w.days.length > 0) {
          const first = w.days[0];
          dateIso = `${first.date}T${first.startTime}:00.000Z`;
          label = w.name;
        }
      } else if (b.ptSessionId) {
        const s = ptSessions.find((x) => x.id === b.ptSessionId);
        if (s) {
          dateIso = s.startsAt;
          label = "Private session";
        }
      }
      return { booking: b, label, dateIso };
    })
    .sort((a, b) => new Date(b.dateIso).getTime() - new Date(a.dateIso).getTime());

  // Cancellation cap window per §4
  const cycleStart = new Date(
    new Date("2026-05-10").getTime() - globalPolicy.cancelCapCycleDays * 24 * 60 * 60 * 1000
  );
  const myCancellationsThisCycle = cancellations.filter(
    (c) =>
      c.clientId === id &&
      c.source === "client" &&
      new Date(c.cancelledAt) >= cycleStart
  );

  // Referrals: who referred this client + who they referred
  const referredBy = client.referredByClientId
    ? clients.find((c) => c.id === client.referredByClientId) ?? null
    : null;
  const theyReferred = clients.filter((c) => c.referredByClientId === id);

  // Attendance aggregates
  const attended = myBookings.filter((b) => b.booking.checkInState === "attended").length;
  const noShows = myBookings.filter((b) => b.booking.checkInState === "no_show").length;

  return (
    <div className="mx-auto max-w-5xl">
      <Link
        href="/admin/clients"
        className="mb-2 inline-flex items-center gap-1 text-sm text-muted hover:text-ink"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> All clients
      </Link>
      <ClientProfileClient
        client={client}
        myPackages={myPackages}
        myAdjustments={myAdjustments}
        myBookings={myBookings}
        cancellationCount={myCancellationsThisCycle.length}
        cancellationCap={globalPolicy.cancelCapCount}
        cycleDays={globalPolicy.cancelCapCycleDays}
        attended={attended}
        noShows={noShows}
        referredBy={referredBy}
        theyReferred={theyReferred}
      />
    </div>
  );
}
