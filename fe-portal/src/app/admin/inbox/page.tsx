"use client";
import { useState } from "react";
import { Check, X, Clock, Inbox as InboxIcon } from "lucide-react";
import { Avatar, Badge, Button, Dialog, DialogFooter, Input, Label, PageHeader } from "@/components/ui";
import { inboxItems as seedInbox } from "@/data";
import { formatDateTime, formatRelative } from "@/lib/formatters";
import type { InboxItem, InboxType } from "@/types";

const TYPE_LABELS: Record<InboxType, { label: string; tone: "accent" | "warning" | "cyan" | "neutral" }> = {
  pt_request: { label: "PT request", tone: "accent" },
  client_cancellation: { label: "Client cancellation", tone: "neutral" },
  admin_cancel_class_pt: { label: "Admin cancel — class/PT", tone: "warning" },
  admin_cancel_workshop: { label: "Admin cancel — workshop", tone: "warning" },
};

type FilterTab = "all" | "unread" | InboxType;

export default function InboxPage() {
  const [items, setItems] = useState<InboxItem[]>(seedInbox);
  const [tab, setTab] = useState<FilterTab>("all");
  const [declineFor, setDeclineFor] = useState<InboxItem | null>(null);

  const unread = items.filter((i) => !i.readAt).length;
  const filtered = items.filter((i) => {
    if (tab === "all") return true;
    if (tab === "unread") return !i.readAt;
    return i.type === tab;
  });

  function markRead(id: string) {
    setItems((p) =>
      p.map((i) => (i.id === id ? { ...i, readAt: i.readAt ?? new Date().toISOString() } : i))
    );
  }

  function toggleRead(id: string) {
    setItems((p) =>
      p.map((i) =>
        i.id === id ? { ...i, readAt: i.readAt ? null : new Date().toISOString() } : i
      )
    );
  }

  function handleApprove(item: InboxItem) {
    setItems((p) =>
      p.map((i) =>
        i.id === item.id
          ? {
              ...i,
              actionTaken: "approved",
              actionAt: new Date().toISOString(),
              readAt: i.readAt ?? new Date().toISOString(),
            }
          : i
      )
    );
    alert("PT request approved (mock). Session confirmed; client notified.");
  }

  function handleDecline(item: InboxItem, note: string) {
    setItems((p) =>
      p.map((i) =>
        i.id === item.id
          ? {
              ...i,
              actionTaken: "declined",
              actionAt: new Date().toISOString(),
              readAt: i.readAt ?? new Date().toISOString(),
              payload: { ...i.payload, declineNote: note },
            }
          : i
      )
    );
    alert("PT request declined (mock). Slot released; client notified.");
    setDeclineFor(null);
  }

  function bulkRead() {
    setItems((p) => p.map((i) => ({ ...i, readAt: i.readAt ?? new Date().toISOString() })));
  }

  return (
    <div>
      <PageHeader
        title="Inbox"
        description="Cancellations and PT requests. Cancellation rows are informational; PT requests are actionable."
        actions={
          unread > 0 ? (
            <Button variant="secondary" onClick={bulkRead}>
              Mark all read
            </Button>
          ) : undefined
        }
      />

      <div className="mb-4 flex flex-wrap gap-1.5">
        <Tab label="All" count={items.length} active={tab === "all"} onClick={() => setTab("all")} />
        <Tab label="Unread" count={unread} active={tab === "unread"} onClick={() => setTab("unread")} />
        <span className="mx-1 self-center text-muted">·</span>
        {(Object.keys(TYPE_LABELS) as InboxType[]).map((t) => (
          <Tab
            key={t}
            label={TYPE_LABELS[t].label}
            count={items.filter((i) => i.type === t).length}
            active={tab === t}
            onClick={() => setTab(t)}
          />
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-xl border border-border bg-card px-6 py-16 text-center shadow-soft">
          <InboxIcon className="mx-auto mb-3 h-8 w-8 text-muted" />
          <p className="text-sm text-muted">No items in this view.</p>
        </div>
      ) : (
        <ul className="space-y-2">
          {filtered.map((item) => (
            <InboxRow
              key={item.id}
              item={item}
              onToggleRead={() => toggleRead(item.id)}
              onMarkRead={() => markRead(item.id)}
              onApprove={() => handleApprove(item)}
              onDecline={() => setDeclineFor(item)}
            />
          ))}
        </ul>
      )}

      {declineFor && (
        <DeclineDialog
          item={declineFor}
          onSubmit={(note) => handleDecline(declineFor, note)}
          onClose={() => setDeclineFor(null)}
        />
      )}
    </div>
  );
}

function Tab({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition ${
        active
          ? "bg-accent text-white"
          : "bg-card text-muted hover:bg-paper hover:text-ink"
      }`}
    >
      {label}
      <span className={active ? "text-white/80" : "text-muted"}>{count}</span>
    </button>
  );
}

function InboxRow({
  item,
  onToggleRead,
  onMarkRead,
  onApprove,
  onDecline,
}: {
  item: InboxItem;
  onToggleRead: () => void;
  onMarkRead: () => void;
  onApprove: () => void;
  onDecline: () => void;
}) {
  const isUnread = !item.readAt;
  const meta = TYPE_LABELS[item.type];
  const isActionable = item.type === "pt_request" && item.actionTaken === null;

  function payloadString(key: string): string {
    return (item.payload[key] as string) ?? "";
  }

  function payloadIso(key: string): string | null {
    const v = item.payload[key];
    return typeof v === "string" ? v : null;
  }

  function onCardClick() {
    if (!isUnread) return;
    onMarkRead();
  }

  return (
    <li
      className={`group rounded-xl border bg-card p-4 shadow-soft transition ${
        isUnread ? "border-accent/30" : "border-border opacity-90"
      }`}
      onClick={onCardClick}
    >
      <div className="mb-1.5 flex items-center gap-2">
        <Badge tone={meta.tone}>{meta.label}</Badge>
        {isUnread && (
          <span className="inline-flex h-2 w-2 rounded-full bg-accent" aria-label="Unread" />
        )}
        <div className="flex-1" />
        <span className="text-xs text-muted">{formatRelative(item.createdAt)}</span>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onToggleRead();
          }}
          className="text-xs text-muted hover:text-ink"
        >
          Mark {isUnread ? "read" : "unread"}
        </button>
      </div>

      {item.type === "pt_request" && (
        <div>
          <div className="mb-2 flex items-center gap-3">
            <Avatar name={payloadString("clientName")} size={32} />
            <div>
              <div className="font-medium text-ink">
                {payloadString("clientName")}{" "}
                <span className="text-muted">→</span>{" "}
                {payloadString("instructorName")}
              </div>
              <div className="text-xs text-muted">
                {payloadIso("requestedStartsAt") &&
                  formatDateTime(payloadIso("requestedStartsAt")!)}
              </div>
            </div>
          </div>
          {payloadString("message") && (
            <p className="mb-3 rounded-lg bg-paper px-3 py-2 text-sm text-ink">
              "{payloadString("message")}"
            </p>
          )}
          {isActionable ? (
            <div
              className="flex gap-2"
              onClick={(e) => e.stopPropagation()}
            >
              <Button size="sm" onClick={onApprove}>
                <Check className="h-3.5 w-3.5" /> Approve
              </Button>
              <Button size="sm" variant="secondary" onClick={onDecline}>
                <X className="h-3.5 w-3.5" /> Decline
              </Button>
            </div>
          ) : (
            <Badge tone={item.actionTaken === "approved" ? "sage" : "error"}>
              {item.actionTaken === "approved" ? "Approved" : "Declined"}
              {item.actionAt && ` · ${formatRelative(item.actionAt)}`}
            </Badge>
          )}
        </div>
      )}

      {item.type === "client_cancellation" && (
        <div>
          <div className="mb-1 flex items-center gap-3">
            <Avatar name={payloadString("clientName")} size={32} />
            <div>
              <div className="font-medium text-ink">{payloadString("clientName")}</div>
              <div className="text-xs text-muted">{payloadString("sessionLabel")}</div>
            </div>
          </div>
          <Badge
            tone={
              payloadString("refundResult") === "credit_returned" ||
              payloadString("refundResult") === "session_returned"
                ? "sage"
                : "neutral"
            }
          >
            {payloadString("refundResult") === "credit_returned" && "Credit returned"}
            {payloadString("refundResult") === "session_returned" && "Session returned"}
            {payloadString("refundResult") === "forfeited" && "Forfeited"}
          </Badge>
        </div>
      )}

      {item.type === "admin_cancel_class_pt" && (
        <div>
          <div className="text-sm text-ink">
            <span className="font-medium">{payloadString("actorName")}</span> cancelled{" "}
            <span className="font-medium">{payloadString("sessionLabel")}</span>
          </div>
          <div className="mt-1 text-xs text-muted">
            {(item.payload.clientsRefunded as number) ?? 0} client
            {(item.payload.clientsRefunded as number) === 1 ? "" : "s"} refunded
          </div>
        </div>
      )}

      {item.type === "admin_cancel_workshop" && (
        <div>
          <div className="text-sm text-ink">
            <span className="font-medium">{payloadString("actorName")}</span> cancelled workshop{" "}
            <span className="font-medium">{payloadString("workshopName")}</span>
          </div>
          <div className="mt-1 text-xs text-muted">
            {(item.payload.attendeesRefunded as number) ?? 0} attendees · SGD{" "}
            {(item.payload.totalRefundedSgd as number) ?? 0} refunded via Stripe
          </div>
        </div>
      )}
    </li>
  );
}

function DeclineDialog({
  item,
  onSubmit,
  onClose,
}: {
  item: InboxItem;
  onSubmit: (note: string) => void;
  onClose: () => void;
}) {
  const [note, setNote] = useState("");
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="Decline private session request"
      description="A note is required so the client receives a useful response."
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (!note.trim()) return;
          onSubmit(note.trim());
        }}
      >
        <div className="space-y-1.5">
          <Label htmlFor="decline-note">Reason / alternative suggestion</Label>
          <textarea
            id="decline-note"
            required
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={`e.g. ${
              (item.payload.instructorName as string) ?? "Instructor"
            } isn't available that morning. Could you do…`}
            className="flex min-h-[100px] w-full rounded-lg border border-border bg-card px-3 py-2 text-sm placeholder:text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          />
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="danger">
            Decline & notify client
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
