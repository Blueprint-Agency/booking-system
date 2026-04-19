"use client";

import Link from "next/link";
import { CalendarDays, Inbox, Receipt, Users } from "lucide-react";
import { useAdminState } from "@/lib/mock-state";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SlaChip } from "@/components/ui/sla-chip";
import { EmptyState } from "@/components/ui/empty-state";
import { slaTier } from "@/lib/sla";
import { formatCurrency, formatTime, getLocationName } from "@/lib/utils";
import instructorsData from "@/data/instructors.json";
import clientsData from "@/data/clients.json";
import type { Instructor, Client } from "@/types";

const TODAY = "2026-04-20";
const instructors = instructorsData as Instructor[];
const clients = clientsData as Client[];

function instructorName(id: string): string {
  return instructors.find((i) => i.id === id)?.name ?? "—";
}
function clientName(id: string): string {
  const c = clients.find((x) => x.id === id);
  return c ? `${c.firstName} ${c.lastName}` : "—";
}

export default function DashboardPage() {
  const state = useAdminState();

  const todaySessions = state.sessions
    .filter((s) => s.date === TODAY && s.status === "scheduled")
    .sort((a, b) => a.time.localeCompare(b.time));

  const pending = state.privateRequests.filter((r) => r.status === "pending");
  const pendingRed = pending.filter((r) => {
    const t = slaTier(r.deadlineAt);
    return t === "red" || t === "overdue";
  });

  const weekStart = "2026-04-13";
  const weekEnd = "2026-04-19";
  const monthStart = "2026-04-01";
  const revToday = state.invoices
    .filter((i) => i.issuedAt.slice(0, 10) === TODAY && i.status === "paid")
    .reduce((sum, i) => sum + i.total, 0);
  const revWeek = state.invoices
    .filter((i) => {
      const d = i.issuedAt.slice(0, 10);
      return d >= weekStart && d <= weekEnd && i.status === "paid";
    })
    .reduce((sum, i) => sum + i.total, 0);
  const revMonth = state.invoices
    .filter((i) => i.issuedAt.slice(0, 10) >= monthStart && i.status === "paid")
    .reduce((sum, i) => sum + i.total, 0);

  const activeClients = clients.filter((c) => c.activityStatus === "active").length;

  return (
    <>
      <PageHeader
        title="Good morning, studio."
        description="Today's operations at a glance."
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 mb-8">
        <StatCard icon={CalendarDays} label="Today's classes"       value={todaySessions.length} hint={`${todaySessions.reduce((s, x) => s + x.bookedCount, 0)} bookings`} />
        <StatCard icon={Inbox}        label="Pending requests"      value={pending.length}       hint={pendingRed.length ? `${pendingRed.length} under 2h SLA` : "All comfortable"} />
        <StatCard icon={Receipt}      label="Revenue today / week"  value={formatCurrency(revToday)} hint={`${formatCurrency(revWeek)} this week · ${formatCurrency(revMonth)} MTD`} />
        <StatCard icon={Users}        label="Active clients"        value={activeClients} hint={`${clients.length} total`} />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-ink">Today's classes</h2>
              <Link href="/schedule" className="text-xs font-medium text-accent-deep hover:underline">
                Full schedule →
              </Link>
            </div>
          </CardHeader>
          <CardBody>
            {todaySessions.length === 0 ? (
              <EmptyState icon={CalendarDays} title="No classes today" description="Enjoy the quiet day." />
            ) : (
              <ul className="divide-y divide-border">
                {todaySessions.map((s) => {
                  const fill = s.capacity === 0 ? 0 : Math.round((s.bookedCount / s.capacity) * 100);
                  return (
                    <li key={s.id} className="flex items-center justify-between py-3">
                      <div>
                        <p className="text-sm font-medium text-ink">
                          {formatTime(s.time)} · {s.name}
                        </p>
                        <p className="text-xs text-muted">
                          {instructorName(s.instructorId)} · {getLocationName(s.locationId)}
                        </p>
                      </div>
                      <div className="flex items-center gap-3">
                        <Badge tone={fill >= 90 ? "error" : fill >= 70 ? "warning" : "sage"}>
                          {s.bookedCount}/{s.capacity}
                        </Badge>
                        <Link
                          href={`/schedule/${s.id}`}
                          className="text-xs font-medium text-accent-deep hover:underline"
                        >
                          Roster
                        </Link>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-ink">Private requests</h2>
              <Link href="/requests" className="text-xs font-medium text-accent-deep hover:underline">
                Inbox →
              </Link>
            </div>
          </CardHeader>
          <CardBody>
            {pending.length === 0 ? (
              <EmptyState icon={Inbox} title="Inbox clear" description="No pending requests." />
            ) : (
              <ul className="divide-y divide-border">
                {pending.slice(0, 5).map((r) => (
                  <li key={r.id} className="py-3">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-medium text-ink">{clientName(r.clientId)}</p>
                      <SlaChip deadlineAt={r.deadlineAt} />
                    </div>
                    <p className="text-xs text-muted mt-0.5 line-clamp-1">{r.notes}</p>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>
    </>
  );
}
