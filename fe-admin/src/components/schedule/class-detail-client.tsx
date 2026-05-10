"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Avatar, Badge, Button, Dialog, DialogFooter } from "@/components/ui";
import type { Booking, ClassInstance, Client, Rating } from "@/types";
import { Star, X, QrCode, KeyRound } from "lucide-react";
import { formatDateTime } from "@/lib/formatters";

type Row = { booking: Booking; client: Client };

export function ClassDetailClient({
  classInstance,
  roster: initialRoster,
  ratings,
}: {
  classInstance: ClassInstance;
  roster: Row[];
  ratings: Rating[];
}) {
  const router = useRouter();
  const [roster, setRoster] = useState<Row[]>(initialRoster);
  const [confirmCancel, setConfirmCancel] = useState(false);

  const confirmed = roster.filter((r) => r.booking.state === "confirmed");
  const cancelled = roster.filter((r) => r.booking.state === "cancelled");
  const pendingCount = confirmed.filter((r) => r.booking.checkInState === "pending").length;
  const checkInState = pendingCount === 0 && confirmed.length > 0 ? "completed" : "pending";

  function flipCheckIn(bookingId: string, to: "attended" | "no_show") {
    setRoster((prev) =>
      prev.map((r) => (r.booking.id === bookingId ? { ...r, booking: { ...r.booking, checkInState: to } } : r))
    );
  }

  function handleCancel() {
    alert(
      `Class cancelled (mock).\n\n${confirmed.length} clients refunded automatically. Inbox notification generated.`
    );
    setConfirmCancel(false);
    router.push("/admin/schedule");
  }

  const isCancellable = classInstance.lifecycle === "active";

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Booked" value={`${confirmed.length} / ${classInstance.capacity}`} />
        <Stat
          label="Check-in state"
          value={checkInState === "completed" ? "Completed" : `Pending — ${pendingCount} left`}
        />
        <Stat
          label="Avg rating"
          value={
            ratings.length > 0
              ? `${(ratings.reduce((s, r) => s + r.stars, 0) / ratings.length).toFixed(1)} / 5`
              : "—"
          }
          sub={`${ratings.length} rating${ratings.length === 1 ? "" : "s"}`}
        />
      </div>

      <section className="rounded-xl border border-border bg-card shadow-soft">
        <header className="flex items-center justify-between border-b border-border px-5 py-3">
          <h2 className="text-sm font-semibold text-ink">Roster</h2>
          {isCancellable && (
            <Button variant="secondary" size="sm" onClick={() => setConfirmCancel(true)}>
              <X className="h-3.5 w-3.5" /> Cancel class
            </Button>
          )}
        </header>
        {confirmed.length === 0 ? (
          <div className="px-5 py-10 text-center text-sm text-muted">No bookings yet.</div>
        ) : (
          <ul className="divide-y divide-border">
            {confirmed.map(({ booking, client }) => (
              <li key={booking.id} className="flex items-center gap-4 px-5 py-3">
                <Avatar name={client.name} size={36} />
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-ink">{client.name}</div>
                  <div className="font-mono text-xs text-muted">{booking.code}</div>
                </div>
                <CheckInControl
                  state={booking.checkInState}
                  onFlip={(to) => flipCheckIn(booking.id, to)}
                />
              </li>
            ))}
          </ul>
        )}
        {cancelled.length > 0 && (
          <div className="border-t border-border px-5 py-3">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">
              Cancelled bookings
            </h3>
            <ul className="space-y-1.5">
              {cancelled.map(({ booking, client }) => (
                <li key={booking.id} className="flex items-center gap-3 text-sm">
                  <span className="text-ink">{client.name}</span>
                  <Badge tone={booking.refundOutcome === "credit_returned" ? "sage" : "error"}>
                    {booking.refundOutcome === "credit_returned"
                      ? "Credit returned"
                      : "Forfeited"}
                  </Badge>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      {ratings.length > 0 && (
        <section className="rounded-xl border border-border bg-card shadow-soft">
          <header className="border-b border-border px-5 py-3">
            <h2 className="text-sm font-semibold text-ink">Ratings & comments</h2>
            <p className="text-xs text-muted">Admin sees full attribution.</p>
          </header>
          <ul className="divide-y divide-border">
            {ratings.map((r) => {
              const c = roster.find((x) => x.client.id === r.clientId)?.client;
              return (
                <li key={r.id} className="px-5 py-3">
                  <div className="mb-1 flex items-center gap-2">
                    <span className="font-medium text-ink">{c?.name ?? "Unknown"}</span>
                    <span className="flex items-center gap-0.5 text-warning">
                      {Array.from({ length: r.stars }).map((_, i) => (
                        <Star key={i} className="h-3.5 w-3.5 fill-current" />
                      ))}
                    </span>
                    <span className="text-xs text-muted">{formatDateTime(r.ratedAt)}</span>
                  </div>
                  {r.comment && <p className="text-sm text-muted">{r.comment}</p>}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <Dialog
        open={confirmCancel}
        onOpenChange={setConfirmCancel}
        title="Cancel this class?"
        description="All confirmed clients will be automatically credited back. An Inbox notification will be generated for each refund."
      >
        <DialogFooter>
          <Button variant="ghost" onClick={() => setConfirmCancel(false)}>
            Keep class
          </Button>
          <Button variant="danger" onClick={handleCancel}>
            Cancel class & refund {confirmed.length} clients
          </Button>
        </DialogFooter>
      </Dialog>
    </div>
  );
}

function CheckInControl({
  state,
  onFlip,
}: {
  state: "pending" | "attended" | "no_show" | "n_a";
  onFlip: (to: "attended" | "no_show") => void;
}) {
  if (state === "attended")
    return <Badge tone="sage">Attended</Badge>;
  if (state === "no_show")
    return <Badge tone="error">No-show</Badge>;
  return (
    <div className="flex gap-1.5">
      <button
        type="button"
        onClick={() => onFlip("attended")}
        className="rounded-md border border-border bg-paper px-2 py-1 text-xs hover:bg-sage/10 hover:text-sage"
      >
        Attended
      </button>
      <button
        type="button"
        onClick={() => onFlip("no_show")}
        className="rounded-md border border-border bg-paper px-2 py-1 text-xs hover:bg-error/10 hover:text-error"
      >
        No-show
      </button>
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
