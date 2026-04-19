"use client";

import { use, useState } from "react";
import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { StatCard } from "@/components/ui/stat-card";
import { ClientTimeline } from "@/components/clients/client-timeline";
import { AdjustCreditsModal } from "@/components/clients/adjust-credits-modal";
import { useAdminState } from "@/lib/mock-state";

export default function ClientProfilePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const state = useAdminState();
  const client = state.clients.find((c) => c.id === id);
  const [adjustOpen, setAdjustOpen] = useState(false);

  if (!client) return notFound();

  const bookings = state.bookings.filter((b) => b.clientId === id);
  const upcoming = bookings.filter((b) => {
    const s = state.sessions.find((x) => x.id === b.sessionId);
    return s ? s.date >= "2026-04-20" && b.status !== "cancelled" : false;
  });
  const activePackages = state.clientPackages.filter(
    (p) => p.clientId === id && p.status === "active",
  );
  const totalCredits = activePackages.reduce((acc, p) => acc + p.creditsRemaining, 0);
  const membership = state.memberships.find(
    (m) => m.clientId === id && m.status === "active",
  );

  return (
    <div className="space-y-6">
      <Link href="/clients" className="inline-flex items-center gap-1 text-sm text-ink/60 hover:text-ink">
        <ArrowLeft className="h-4 w-4" /> Back to clients
      </Link>

      <PageHeader
        title={`${client.firstName} ${client.lastName}`}
        description={`${client.email} · ${client.phone}`}
        actions={<Button onClick={() => setAdjustOpen(true)}>Adjust credits</Button>}
      />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
        <StatCard label="Credits" value={String(totalCredits)} hint={`${activePackages.length} active pkg`} />
        <StatCard label="Upcoming" value={String(upcoming.length)} />
        <StatCard label="Total sessions" value={String(client.totalSessions)} />
        <StatCard label="No-shows" value={String(client.noShowCount)} />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="px-5 py-4 lg:col-span-2">
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-ink/70">
            Activity timeline
          </h3>
          <ClientTimeline
            clientId={id}
            bookings={state.bookings}
            sessions={state.sessions}
            creditAdjustments={state.creditAdjustments}
          />
        </Card>

        <div className="space-y-4">
          <Card className="px-5 py-4">
            <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-ink/70">
              Membership
            </h3>
            {membership ? (
              <div className="text-sm">
                <Badge tone="sage">{membership.status}</Badge>
                <div className="mt-1 text-xs text-ink/60">
                  {membership.startsAt} → {membership.endsAt}
                </div>
              </div>
            ) : (
              <div className="text-sm text-ink/50">None</div>
            )}
          </Card>

          <Card className="px-5 py-4">
            <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-ink/70">
              Waiver
            </h3>
            {client.waiverSigned ? (
              <div>
                <Badge tone="sage">signed v{client.waiverVersion ?? "–"}</Badge>
                <div className="mt-1 text-xs text-ink/60">{client.waiverSignedAt}</div>
              </div>
            ) : (
              <Badge tone="warning">unsigned</Badge>
            )}
          </Card>

          <Card className="px-5 py-4">
            <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-ink/70">
              Referral
            </h3>
            <div className="font-mono text-sm text-ink">{client.referralCode}</div>
            {client.referredBy && (
              <div className="mt-1 text-xs text-ink/60">Referred by {client.referredBy}</div>
            )}
          </Card>

          {client.notes && (
            <Card className="px-5 py-4">
              <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-ink/70">
                Notes
              </h3>
              <p className="whitespace-pre-wrap text-sm text-ink/80">{client.notes}</p>
            </Card>
          )}
        </div>
      </div>

      <AdjustCreditsModal
        client={client}
        clientPackages={state.clientPackages}
        products={state.products}
        open={adjustOpen}
        onClose={() => setAdjustOpen(false)}
      />
    </div>
  );
}
