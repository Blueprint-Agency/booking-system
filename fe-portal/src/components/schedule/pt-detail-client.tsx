"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { Avatar, Badge, Button, Dialog, DialogFooter } from "@/components/ui";
import type { Booking, Client, PtSession } from "@/types";

type Row = { booking: Booking; client: Client };

export function PtDetailClient({
  ptSession,
  roster: initialRoster,
}: {
  ptSession: PtSession;
  roster: Row[];
}) {
  const router = useRouter();
  const [roster, setRoster] = useState<Row[]>(initialRoster);
  const [confirm, setConfirm] = useState(false);

  function flipCheckIn(bookingId: string, to: "attended" | "no_show") {
    setRoster((prev) =>
      prev.map((r) => (r.booking.id === bookingId ? { ...r, booking: { ...r.booking, checkInState: to } } : r))
    );
  }

  function handleCancel() {
    alert(
      `PT session cancelled (mock).\n\nFull session returned to ${roster.length} customer${roster.length === 1 ? "'s" : "s'"} package automatically. Inbox notification generated.`
    );
    setConfirm(false);
    router.push("/admin/schedule");
  }

  const isCancellable = ptSession.lifecycle === "active";

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-border bg-card shadow-soft">
        <header className="flex items-center justify-between border-b border-border px-5 py-3">
          <h2 className="text-sm font-semibold text-ink">
            Customer{roster.length > 1 ? "s" : ""}
          </h2>
          {isCancellable && (
            <Button variant="secondary" size="sm" onClick={() => setConfirm(true)}>
              <X className="h-3.5 w-3.5" /> Cancel session
            </Button>
          )}
        </header>
        <ul className="divide-y divide-border">
          {roster.map(({ booking, client }) => (
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
      </section>

      <Dialog
        open={confirm}
        onOpenChange={setConfirm}
        title="Cancel this private session?"
        description={`Full session will be returned to ${roster.length === 1 ? "the customer's" : "each customer's"} PT package automatically.`}
      >
        <DialogFooter>
          <Button variant="ghost" onClick={() => setConfirm(false)}>
            Keep session
          </Button>
          <Button variant="danger" onClick={handleCancel}>
            Cancel session
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
  if (state === "attended") return <Badge tone="sage">Attended</Badge>;
  if (state === "no_show") return <Badge tone="error">No-show</Badge>;
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
