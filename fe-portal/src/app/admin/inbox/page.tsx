"use client";
// FIXTURE-BACKED: reads static mock data from `@/data`, not the live backend.
import { useState } from "react";
import { Inbox as InboxIcon } from "lucide-react";
import { Avatar, Badge, Button, PageHeader } from "@/components/ui";
import { inboxItems as seedInbox, locations, workshops } from "@/data";
import { formatRelative } from "@/lib/formatters";
import { useWorkspace } from "@/lib/workspace-context";
import type { InboxItem } from "@/types";
import type { InboxType } from "@/types";

function resolveItemLocationId(item: InboxItem): string | null {
  if (item.type === "admin_cancel_workshop") {
    const wid = (item.payload.workshopId as string | undefined) ?? null;
    if (wid) {
      const w = workshops.find((x) => x.id === wid);
      if (w) return w.locationId;
    }
  }
  const label = (item.payload.sessionLabel as string | undefined) ?? "";
  if (label) {
    for (const loc of locations) {
      if (label.includes(loc.name)) return loc.id;
    }
  }
  return null;
}

const TYPE_LABELS: Record<InboxType, { label: string; tone: "accent" | "warning" | "cyan" | "neutral" }> = {
  client_cancellation: { label: "Customer cancellation", tone: "neutral" },
  admin_cancel_class_pt: { label: "Admin cancel — class/PT", tone: "warning" },
  admin_cancel_workshop: { label: "Admin cancel — workshop", tone: "warning" },
};

type FilterTab = "all" | "unread" | InboxType;

export default function InboxPage() {
  const { activeLocationId } = useWorkspace();
  const [items, setItems] = useState<InboxItem[]>(seedInbox);
  const [tab, setTab] = useState<FilterTab>("all");

  const scopedItems = activeLocationId
    ? items.filter((i) => {
        const loc = resolveItemLocationId(i);
        return loc === null || loc === activeLocationId;
      })
    : items;

  const unread = scopedItems.filter((i) => !i.readAt).length;
  const filtered = scopedItems.filter((i) => {
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

  function bulkRead() {
    setItems((p) => p.map((i) => ({ ...i, readAt: i.readAt ?? new Date().toISOString() })));
  }

  return (
    <div>
      <PageHeader
        title="Inbox"
        description="Cancellation events. PT requests now live under Operations → PT Requests."
        actions={
          unread > 0 ? (
            <Button variant="secondary" onClick={bulkRead}>
              Mark all read
            </Button>
          ) : undefined
        }
      />

      <div className="mb-4 flex flex-wrap gap-1.5">
        <Tab label="All" count={scopedItems.length} active={tab === "all"} onClick={() => setTab("all")} />
        <Tab label="Unread" count={unread} active={tab === "unread"} onClick={() => setTab("unread")} />
        <span className="mx-1 self-center text-muted">·</span>
        {(Object.keys(TYPE_LABELS) as InboxType[]).map((t) => (
          <Tab
            key={t}
            label={TYPE_LABELS[t].label}
            count={scopedItems.filter((i) => i.type === t).length}
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
            />
          ))}
        </ul>
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
        active ? "bg-accent text-white" : "bg-card text-muted hover:bg-paper hover:text-ink"
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
}: {
  item: InboxItem;
  onToggleRead: () => void;
  onMarkRead: () => void;
}) {
  const isUnread = !item.readAt;
  const meta = TYPE_LABELS[item.type];

  function payloadString(key: string): string {
    return (item.payload[key] as string) ?? "";
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
      <div className="mb-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
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
