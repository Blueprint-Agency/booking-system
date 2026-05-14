"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Star, X } from "lucide-react";
import { Avatar, Badge, Button, Dialog, DialogFooter } from "@/components/ui";
import { formatSgd, formatDateTime } from "@/lib/formatters";
import { maxCapacity } from "@/lib/capacity";
import type { Booking, Client, Rating, Workshop, WorkshopTier } from "@/types";

type Row = { booking: Booking; client: Client; tier?: WorkshopTier };

export function WorkshopDetailClient({
  workshop,
  tiers,
  roster,
  ratings,
}: {
  workshop: Workshop;
  tiers: WorkshopTier[];
  roster: Row[];
  ratings: Rating[];
}) {
  const router = useRouter();
  const [confirm, setConfirm] = useState(false);

  const confirmed = roster.filter((r) => r.booking.state === "confirmed");

  function tierStats(tier: WorkshopTier) {
    const booked = confirmed.filter((r) => r.booking.workshopTierId === tier.id).length;
    const dayCaps = tier.dayIds
      .map((did) => workshop.days.find((d) => d.id === did))
      .filter((d): d is NonNullable<typeof d> => Boolean(d))
      .map((d) => maxCapacity(d.capacity));
    const capacity = dayCaps.length > 0 ? Math.min(...dayCaps) : 0;
    return { booked, capacity, soldOut: capacity > 0 && booked >= capacity };
  }

  function handleCancel() {
    alert(
      `Workshop cancelled (mock).\n\nFull Stripe refund issued to ${confirmed.length} attendees automatically. Inbox notification generated.`
    );
    setConfirm(false);
    router.push("/admin/schedule");
  }

  const totalRefund = confirmed.reduce((s, r) => {
    if (!r.tier) return s;
    return s + r.tier.priceSgd;
  }, 0);

  const isCancellable = workshop.lifecycle === "active";

  return (
    <div className="space-y-6">
      <section
        className="rounded-xl border border-border bg-card p-5 shadow-soft"
        dangerouslySetInnerHTML={{ __html: workshop.descriptionHtml }}
      />

      <section className="rounded-xl border border-border bg-card shadow-soft">
        <header className="flex items-center justify-between border-b border-border px-5 py-3">
          <h2 className="text-sm font-semibold text-ink">Tiers</h2>
        </header>
        <div className="grid gap-0 divide-y divide-border">
          {tiers.map((t) => {
            const s = tierStats(t);
            return (
              <div key={t.id} className="flex items-center gap-4 px-5 py-3">
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-ink">{t.name}</div>
                  <div className="text-xs text-muted">{t.description}</div>
                  <div className="mt-1 flex flex-wrap gap-1.5 text-xs">
                    <span className="font-mono text-ink">{formatSgd(t.priceSgd)}</span>
                    {t.earlyBirdPriceSgd && (
                      <span className="text-muted">
                        early bird {formatSgd(t.earlyBirdPriceSgd)}
                      </span>
                    )}
                  </div>
                </div>
                <div className="text-right text-xs">
                  <div className="font-mono font-semibold text-ink">
                    {s.booked} / {s.capacity}
                  </div>
                  {s.soldOut && <Badge tone="error">Sold out</Badge>}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section className="rounded-xl border border-border bg-card shadow-soft">
        <header className="flex items-center justify-between border-b border-border px-5 py-3">
          <div>
            <h2 className="text-sm font-semibold text-ink">Attendees</h2>
            <p className="text-xs text-muted">No check-in tracking for workshops.</p>
          </div>
          {isCancellable && (
            <Button variant="secondary" size="sm" onClick={() => setConfirm(true)}>
              <X className="h-3.5 w-3.5" /> Cancel workshop
            </Button>
          )}
        </header>
        {confirmed.length === 0 ? (
          <div className="px-5 py-10 text-center text-sm text-muted">No bookings yet.</div>
        ) : (
          <ul className="divide-y divide-border">
            {confirmed.map(({ booking, client, tier }) => (
              <li key={booking.id} className="flex items-center gap-4 px-5 py-3">
                <Avatar name={client.name} size={36} />
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-ink">{client.name}</div>
                  <div className="text-xs text-muted">{tier?.name ?? "—"}</div>
                </div>
                <Badge tone="cyan">{tier?.name ?? "Tier"}</Badge>
              </li>
            ))}
          </ul>
        )}
      </section>

      {ratings.length > 0 && (
        <section className="rounded-xl border border-border bg-card shadow-soft">
          <header className="border-b border-border px-5 py-3">
            <h2 className="text-sm font-semibold text-ink">Ratings & comments</h2>
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
        open={confirm}
        onOpenChange={setConfirm}
        title="Cancel this workshop?"
        description={`All ${confirmed.length} attendees will receive a full Stripe refund automatically (~${formatSgd(totalRefund)} total).`}
      >
        <DialogFooter>
          <Button variant="ghost" onClick={() => setConfirm(false)}>
            Keep workshop
          </Button>
          <Button variant="danger" onClick={handleCancel}>
            Cancel & refund {confirmed.length} attendees
          </Button>
        </DialogFooter>
      </Dialog>
    </div>
  );
}
