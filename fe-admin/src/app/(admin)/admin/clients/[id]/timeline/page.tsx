"use client";

import { useParams } from "next/navigation";
import { useMemo } from "react";
import {
  CalendarPlus,
  CalendarX,
  CheckCircle,
  XCircle,
  Heart,
  CreditCard,
  Package as PackageIcon,
  StickyNote,
} from "lucide-react";
import { useAdminState } from "@/lib/admin-state";
import { formatDateTime, formatRelative, formatCurrency } from "@/lib/formatters";
import { EmptyState, Badge } from "@/components/ui";
import type { LucideIcon } from "lucide-react";

type EventKind =
  | "booking-created"
  | "booking-attended"
  | "booking-no-show"
  | "booking-cancelled"
  | "private-request"
  | "package-purchased"
  | "package-expired"
  | "invoice"
  | "audit";

interface TimelineEvent {
  id: string;
  ts: string;
  kind: EventKind;
  title: string;
  detail: string;
  meta?: string;
}

const KIND_META: Record<EventKind, { icon: LucideIcon; tone: "sage" | "neutral" | "warning" | "error" | "accent" }> = {
  "booking-created": { icon: CalendarPlus, tone: "neutral" },
  "booking-attended": { icon: CheckCircle, tone: "sage" },
  "booking-no-show": { icon: XCircle, tone: "error" },
  "booking-cancelled": { icon: CalendarX, tone: "warning" },
  "private-request": { icon: Heart, tone: "accent" },
  "package-purchased": { icon: PackageIcon, tone: "sage" },
  "package-expired": { icon: PackageIcon, tone: "warning" },
  invoice: { icon: CreditCard, tone: "neutral" },
  audit: { icon: StickyNote, tone: "neutral" },
};

const KIND_LABEL: Record<EventKind, string> = {
  "booking-created": "Booked",
  "booking-attended": "Attended",
  "booking-no-show": "No-show",
  "booking-cancelled": "Cancelled",
  "private-request": "Private session request",
  "package-purchased": "Package purchased",
  "package-expired": "Package expired",
  invoice: "Invoice",
  audit: "Note",
};

function sessionKindLabel(type: string | undefined): string {
  if (type === "workshop") return "Workshop";
  if (type === "event") return "Event";
  return "Class";
}

export default function TimelinePage() {
  const { id } = useParams<{ id: string }>();
  const allBookings = useAdminState((s) => s.bookings);
  const sessions = useAdminState((s) => s.sessions);
  const allInvoices = useAdminState((s) => s.invoices);
  const allPackages = useAdminState((s) => s.clientPackages);
  const products = useAdminState((s) => s.products);
  const allPrivateRequests = useAdminState((s) => s.privateRequests);
  const allAudit = useAdminState((s) => s.auditLog);
  const instructors = useAdminState((s) => s.instructors);

  const bookings = useMemo(
    () => allBookings.filter((b) => b.clientId === id),
    [allBookings, id],
  );
  const invoices = useMemo(
    () => allInvoices.filter((i) => i.clientId === id),
    [allInvoices, id],
  );
  const packages = useMemo(
    () => allPackages.filter((p) => p.clientId === id),
    [allPackages, id],
  );
  const privateRequests = useMemo(
    () => allPrivateRequests.filter((r) => r.clientId === id),
    [allPrivateRequests, id],
  );
  const audit = useMemo(
    () => allAudit.filter((a) => a.entityType === "Client" && a.entityId === id),
    [allAudit, id],
  );

  const events = useMemo<TimelineEvent[]>(() => {
    const list: TimelineEvent[] = [];

    bookings.forEach((b) => {
      const s = sessions.find((ss) => ss.id === b.sessionId);
      const sessionLabel = s
        ? `${sessionKindLabel(s.type)} · ${s.name}`
        : "Booking";

      list.push({
        id: `b-${b.id}-c`,
        ts: b.createdAt,
        kind: "booking-created",
        title: KIND_LABEL["booking-created"],
        detail: sessionLabel,
        meta: s ? `${s.date} ${s.time}` : undefined,
      });

      if (b.status === "cancelled" && b.cancelledAt) {
        list.push({
          id: `b-${b.id}-x`,
          ts: b.cancelledAt,
          kind: "booking-cancelled",
          title: KIND_LABEL["booking-cancelled"],
          detail: `${sessionLabel}${b.cancelReason ? ` · ${b.cancelReason}` : ""}`,
        });
      }

      if (b.checkInStatus === "attended" && s) {
        list.push({
          id: `b-${b.id}-a`,
          ts: `${s.date}T${s.time}:00`,
          kind: "booking-attended",
          title: KIND_LABEL["booking-attended"],
          detail: sessionLabel,
        });
      } else if (b.checkInStatus === "no-show" && s) {
        list.push({
          id: `b-${b.id}-n`,
          ts: `${s.date}T${s.time}:00`,
          kind: "booking-no-show",
          title: KIND_LABEL["booking-no-show"],
          detail: sessionLabel,
        });
      }
    });

    privateRequests.forEach((r) => {
      const ins = instructors.find((i) => i.id === r.instructorId);
      list.push({
        id: `pr-${r.id}`,
        ts: r.requestedAt,
        kind: "private-request",
        title: KIND_LABEL["private-request"],
        detail: `with ${ins?.name ?? "instructor"} · ${r.status}`,
      });
    });

    packages.forEach((p) => {
      const product = products.find((pp) => pp.id === p.productId);
      list.push({
        id: `p-${p.id}`,
        ts: p.purchasedAt,
        kind: "package-purchased",
        title: KIND_LABEL["package-purchased"],
        detail: `${product?.name ?? "Package"} · ${p.sessionsRemaining}/${p.sessionsTotal} credits`,
      });
      if (p.status === "expired" && p.expiresAt) {
        list.push({
          id: `p-${p.id}-x`,
          ts: p.expiresAt,
          kind: "package-expired",
          title: KIND_LABEL["package-expired"],
          detail: product?.name ?? "Package",
        });
      }
    });

    invoices.forEach((i) =>
      list.push({
        id: `i-${i.id}`,
        ts: i.issuedAt,
        kind: "invoice",
        title: i.invoiceNumber,
        detail: `${formatCurrency(i.amountCents)} · ${i.status}`,
      }),
    );

    audit.forEach((a) =>
      list.push({
        id: `a-${a.id}`,
        ts: a.ts,
        kind: "audit",
        title: a.action,
        detail: a.note ?? "",
      }),
    );

    return list.sort((a, b) => (a.ts < b.ts ? 1 : -1));
  }, [bookings, sessions, invoices, packages, products, privateRequests, instructors, audit]);

  if (events.length === 0) {
    return (
      <EmptyState
        title="No activity yet"
        description="Bookings, packages, attendance, and notes show up here."
      />
    );
  }

  return (
    <ol className="space-y-4">
      {events.map((e) => {
        const meta = KIND_META[e.kind];
        const Icon = meta.icon;
        return (
          <li key={e.id} className="flex gap-3">
            <div className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-warm">
              <Icon className="h-4 w-4 text-muted" />
            </div>
            <div className="flex-1 border-b border-border pb-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Badge tone={meta.tone}>{e.title}</Badge>
                  <span className="font-medium text-ink">{e.detail}</span>
                </div>
                <span className="text-xs text-muted whitespace-nowrap">
                  {formatRelative(e.ts)}
                </span>
              </div>
              <div className="text-xs text-muted mt-0.5">
                {formatDateTime(e.ts)}
                {e.meta ? ` · ${e.meta}` : ""}
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
