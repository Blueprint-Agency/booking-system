"use client";
import Link from "next/link";
import { useState } from "react";
import { ShieldOff, ShieldCheck, Plus, Mail, Phone, FileCheck } from "lucide-react";
import { Avatar, Badge, Button, Dialog, DialogFooter, Input, Label } from "@/components/ui";
import { formatDate, formatDateTime, formatRelative, formatSgd } from "@/lib/formatters";
import type { Booking, Client, ClientPackage, ManualAdjustment } from "@/types";

type BookingRow = { booking: Booking; label: string; dateIso: string };

export function ClientProfileClient({
  client: initialClient,
  myPackages: initialPackages,
  myAdjustments: initialAdjustments,
  myBookings,
  cancellationCount,
  cancellationCap,
  cycleDays,
  attended,
  noShows,
  referredBy,
  theyReferred,
}: {
  client: Client;
  myPackages: ClientPackage[];
  myAdjustments: ManualAdjustment[];
  myBookings: BookingRow[];
  cancellationCount: number;
  cancellationCap: number;
  cycleDays: number;
  attended: number;
  noShows: number;
  referredBy: Client | null;
  theyReferred: Client[];
}) {
  const [client, setClient] = useState(initialClient);
  const [packages, setPackages] = useState(initialPackages);
  const [adjustments, setAdjustments] = useState(initialAdjustments);
  const [adjustDialog, setAdjustDialog] = useState(false);
  const [statusDialog, setStatusDialog] = useState(false);

  const isSuspended = client.status === "suspended";
  const upcomingBookings = myBookings.filter(
    (b) => b.booking.state === "confirmed" && new Date(b.dateIso) >= new Date("2026-05-10")
  );
  const pastBookings = myBookings.filter(
    (b) => !(b.booking.state === "confirmed" && new Date(b.dateIso) >= new Date("2026-05-10"))
  );

  const adjustablePackages = packages.filter((p) => p.kind !== "unlimited");

  function toggleStatus() {
    const next = isSuspended ? "active" : "suspended";
    setClient({
      ...client,
      status: next,
      suspendedAt: next === "suspended" ? new Date().toISOString() : null,
    });
    setStatusDialog(false);
  }

  function applyAdjustment(packageId: string, delta: number, reason: string) {
    setPackages((prev) =>
      prev.map((p) => {
        if (p.id !== packageId) return p;
        if (p.creditsOrSessionsRemaining === null) return p;
        const next = p.creditsOrSessionsRemaining + delta;
        if (next < 0) {
          alert("Adjustment blocked — balance cannot go below zero.");
          return p;
        }
        return { ...p, creditsOrSessionsRemaining: next };
      })
    );
    const newAdj: ManualAdjustment = {
      id: `adj-${Date.now().toString(36)}`,
      clientId: client.id,
      clientPackageId: packageId,
      delta,
      reason,
      actedByStaffId: "stf-admin-1",
      createdAt: new Date().toISOString(),
    };
    setAdjustments((prev) => [newAdj, ...prev]);
    setAdjustDialog(false);
  }

  return (
    <div className="space-y-6">
      <header className="flex items-start gap-4 border-b border-border pb-6">
        <Avatar name={client.name} size={64} />
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold text-ink">{client.name}</h1>
            {isSuspended ? (
              <Badge tone="error">
                <ShieldOff className="mr-1 h-3 w-3" /> Suspended
              </Badge>
            ) : (
              <Badge tone="sage">
                <ShieldCheck className="mr-1 h-3 w-3" /> Active
              </Badge>
            )}
          </div>
          <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted">
            <span className="inline-flex items-center gap-1.5">
              <Mail className="h-3 w-3" /> {client.email}
            </span>
            <span className="inline-flex items-center gap-1.5 font-mono">
              <Phone className="h-3 w-3" /> {client.phone}
            </span>
            <span>Joined {formatDate(client.joinedAt)}</span>
            <span className="inline-flex items-center gap-1.5">
              <FileCheck className="h-3 w-3" /> Waiver signed{" "}
              {formatDate(client.waiverSignedAt)}
            </span>
          </div>
        </div>
        <Button variant="secondary" onClick={() => setStatusDialog(true)}>
          {isSuspended ? "Reactivate" : "Suspend"}
        </Button>
      </header>

      <div className="grid gap-3 sm:grid-cols-4">
        <Stat label="Active packages" value={packages.length.toString()} />
        <Stat label="Sessions attended" value={attended.toString()} />
        <Stat label="No-shows" value={noShows.toString()} />
        <Stat
          label="Cancellations (cycle)"
          value={`${cancellationCount} / ${cancellationCap}`}
          sub={`${cycleDays}-day cycle`}
        />
      </div>

      <section>
        <header className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-ink">Active packages</h2>
          {adjustablePackages.length > 0 && (
            <Button size="sm" variant="secondary" onClick={() => setAdjustDialog(true)}>
              <Plus className="h-3.5 w-3.5" /> Manual adjustment
            </Button>
          )}
        </header>
        {packages.length === 0 ? (
          <div className="rounded-xl border border-border bg-card px-5 py-10 text-center text-sm text-muted shadow-soft">
            No packages purchased yet.
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {packages.map((p) => (
              <div
                key={p.id}
                className="rounded-xl border border-border bg-card p-4 shadow-soft"
              >
                <div className="mb-1 flex items-center gap-2">
                  <span className="font-medium text-ink">{p.packageName}</span>
                  <Badge
                    tone={
                      p.kind === "credit_bundle"
                        ? "accent"
                        : p.kind === "unlimited"
                        ? "warning"
                        : "cyan"
                    }
                  >
                    {p.kind === "credit_bundle"
                      ? "Credit"
                      : p.kind === "unlimited"
                      ? "Unlimited"
                      : "PT"}
                  </Badge>
                </div>
                {p.creditsOrSessionsRemaining !== null && p.creditsOrSessionsTotal !== null ? (
                  <div className="font-mono text-sm text-ink">
                    {p.creditsOrSessionsRemaining} / {p.creditsOrSessionsTotal}{" "}
                    {p.kind === "pt" ? "sessions" : "credits"}
                  </div>
                ) : (
                  <div className="font-mono text-sm text-ink">Unlimited</div>
                )}
                <div className="text-xs text-muted">
                  {p.expiresAt
                    ? `Valid until ${formatDate(p.expiresAt)}`
                    : "No expiry"}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {adjustments.length > 0 && (
        <section>
          <h2 className="mb-3 text-sm font-semibold text-ink">Manual adjustments</h2>
          <div className="rounded-xl border border-border bg-card shadow-soft">
            <ul className="divide-y divide-border">
              {adjustments.map((a) => {
                const pkg = packages.find((p) => p.id === a.clientPackageId);
                return (
                  <li key={a.id} className="flex items-start gap-3 px-5 py-3">
                    <Badge tone={a.delta > 0 ? "sage" : "error"}>
                      {a.delta > 0 ? "+" : ""}
                      {a.delta}
                    </Badge>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm text-ink">{pkg?.packageName ?? "Package"}</div>
                      <div className="text-xs text-muted">{a.reason}</div>
                    </div>
                    <span className="text-xs text-muted">{formatRelative(a.createdAt)}</span>
                  </li>
                );
              })}
            </ul>
          </div>
        </section>
      )}

      <section>
        <h2 className="mb-3 text-sm font-semibold text-ink">Bookings</h2>
        <div className="space-y-4">
          <BookingTable title="Upcoming" rows={upcomingBookings} />
          <BookingTable title="Past" rows={pastBookings} />
        </div>
      </section>

      {(referredBy || theyReferred.length > 0) && (
        <section>
          <h2 className="mb-3 text-sm font-semibold text-ink">Referrals</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-border bg-card p-4 shadow-soft">
              <div className="mb-2 text-xs font-medium uppercase tracking-wider text-muted">
                Referred by
              </div>
              {referredBy ? (
                <Link
                  href={`/admin/clients/${referredBy.id}`}
                  className="flex items-center gap-2 hover:text-accent"
                >
                  <Avatar name={referredBy.name} size={28} />
                  <span className="font-medium">{referredBy.name}</span>
                </Link>
              ) : (
                <p className="text-sm text-muted">—</p>
              )}
            </div>
            <div className="rounded-xl border border-border bg-card p-4 shadow-soft">
              <div className="mb-2 text-xs font-medium uppercase tracking-wider text-muted">
                Referred ({theyReferred.length})
              </div>
              {theyReferred.length === 0 ? (
                <p className="text-sm text-muted">—</p>
              ) : (
                <ul className="space-y-1.5">
                  {theyReferred.map((r) => (
                    <li key={r.id}>
                      <Link
                        href={`/admin/clients/${r.id}`}
                        className="flex items-center gap-2 text-sm hover:text-accent"
                      >
                        <Avatar name={r.name} size={24} />
                        <span>{r.name}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </section>
      )}

      {adjustDialog && (
        <AdjustmentDialog
          packages={adjustablePackages}
          onSubmit={applyAdjustment}
          onClose={() => setAdjustDialog(false)}
        />
      )}

      {statusDialog && (
        <Dialog
          open
          onOpenChange={(o) => !o && setStatusDialog(false)}
          title={isSuspended ? "Reactivate client?" : "Suspend client?"}
          description={
            isSuspended
              ? "Client will be able to book again."
              : "Client cannot make new bookings. Existing upcoming bookings are unaffected."
          }
        >
          <DialogFooter>
            <Button variant="ghost" onClick={() => setStatusDialog(false)}>
              Cancel
            </Button>
            <Button variant={isSuspended ? "primary" : "danger"} onClick={toggleStatus}>
              {isSuspended ? "Reactivate" : "Suspend"}
            </Button>
          </DialogFooter>
        </Dialog>
      )}
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-soft">
      <div className="text-xs font-medium uppercase tracking-wide text-muted">{label}</div>
      <div className="mt-1 font-mono text-lg font-semibold text-ink">{value}</div>
      {sub && <div className="text-xs text-muted">{sub}</div>}
    </div>
  );
}

function BookingTable({ title, rows }: { title: string; rows: BookingRow[] }) {
  if (rows.length === 0) return null;
  return (
    <div>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">{title}</h3>
      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-soft">
        <ul className="divide-y divide-border">
          {rows.slice(0, 8).map(({ booking, label, dateIso }) => (
            <li key={booking.id} className="flex items-center gap-3 px-5 py-2.5 text-sm">
              <Badge
                tone={
                  booking.kind === "class" ? "cyan" : booking.kind === "workshop" ? "warning" : "accent"
                }
              >
                {booking.kind === "pt" ? "Private" : booking.kind}
              </Badge>
              <span className="text-ink">{label}</span>
              <span className="text-xs text-muted">{formatDateTime(dateIso)}</span>
              <div className="flex-1" />
              {booking.state === "cancelled" ? (
                <Badge tone={booking.refundOutcome === "credit_returned" || booking.refundOutcome === "session_returned" ? "sage" : "neutral"}>
                  Cancelled · {booking.refundOutcome === "credit_returned" ? "credit back" : booking.refundOutcome === "session_returned" ? "session back" : booking.refundOutcome === "stripe_refunded" ? "refunded" : "forfeited"}
                </Badge>
              ) : booking.checkInState === "attended" ? (
                <Badge tone="sage">Attended</Badge>
              ) : booking.checkInState === "no_show" ? (
                <Badge tone="error">No-show</Badge>
              ) : (
                <Badge tone="accent">Confirmed</Badge>
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function AdjustmentDialog({
  packages,
  onSubmit,
  onClose,
}: {
  packages: ClientPackage[];
  onSubmit: (packageId: string, delta: number, reason: string) => void;
  onClose: () => void;
}) {
  const [packageId, setPackageId] = useState(packages[0]?.id ?? "");
  const [delta, setDelta] = useState("");
  const [reason, setReason] = useState("");

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="Manual credit / session adjustment"
      description="Use a signed integer (e.g. +3 or −1). Audit-logged with your name."
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          const n = Number(delta);
          if (!packageId || !n || !reason.trim()) return;
          onSubmit(packageId, n, reason.trim());
        }}
      >
        <div className="space-y-1.5">
          <Label>Package</Label>
          <select
            required
            value={packageId}
            onChange={(e) => setPackageId(e.target.value)}
            className="flex h-10 w-full rounded-lg border border-border bg-card px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            {packages.map((p) => (
              <option key={p.id} value={p.id}>
                {p.packageName} ({p.creditsOrSessionsRemaining} remaining)
              </option>
            ))}
          </select>
          <p className="text-[11px] text-muted">
            Unlimited passes are not adjustable by count.
          </p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="delta">Adjustment</Label>
          <Input
            id="delta"
            required
            type="number"
            value={delta}
            onChange={(e) => setDelta(e.target.value)}
            placeholder="+1, -2, …"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="reason">Reason</Label>
          <textarea
            id="reason"
            required
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Free text — required for the audit log."
            className="flex min-h-[80px] w-full rounded-lg border border-border bg-card px-3 py-2 text-sm placeholder:text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          />
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit">Apply adjustment</Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
