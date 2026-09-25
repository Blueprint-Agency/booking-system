"use client";

import { useMemo, useState } from "react";
import {
  Building2,
  CheckCircle2,
  Clock,
  MessageCircle,
  XCircle,
} from "lucide-react";
import { AccountPageHeader } from "@/components/account/account-page-header";
import { SegmentedTabs } from "@/components/account/segmented-tabs";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { useBrandCopy } from "@/components/brand/brand-provider";
import {
  ApiCorporateRequest,
  ApiCorporateRequestStatus,
  corporateWhatsappHref,
  useCorporateRequests,
  WHATSAPP_COPY_KEY,
} from "@/lib/corporate";

type Tab = "pending" | "confirmed" | "past" | "cancelled";

const TAB_LABEL: Record<Tab, string> = {
  pending: "Pending",
  confirmed: "Confirmed",
  past: "Past",
  cancelled: "Cancelled",
};

function inTab(r: ApiCorporateRequest, t: Tab): boolean {
  switch (t) {
    case "pending":
      return r.status === "pending";
    case "confirmed":
      return r.status === "scheduled";
    case "past":
      return r.status === "attended";
    case "cancelled":
      return r.status === "cancelled";
  }
}

function statusBadge(status: ApiCorporateRequestStatus) {
  switch (status) {
    case "pending":
      return { label: "Pending", tone: "bg-accent/10 text-accent", icon: Clock };
    case "scheduled":
      return { label: "Confirmed", tone: "bg-sage/15 text-sage", icon: CheckCircle2 };
    case "attended":
      return { label: "Done", tone: "bg-sage/15 text-sage", icon: CheckCircle2 };
    case "cancelled":
      return { label: "Cancelled", tone: "bg-warm text-muted", icon: XCircle };
  }
}

function emptyTitle(tab: Tab): string {
  switch (tab) {
    case "pending":
      return "No pending requests";
    case "confirmed":
      return "No confirmed sessions";
    case "past":
      return "No past sessions";
    case "cancelled":
      return "No cancelled requests";
  }
}

function formatSessionWindow(startsAt: string, endsAt: string): string {
  const start = new Date(startsAt);
  const end = new Date(endsAt);
  const date = start.toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  const timeOpts: Intl.DateTimeFormatOptions = {
    hour: "numeric",
    minute: "2-digit",
  };
  return `${date} · ${start.toLocaleTimeString(undefined, timeOpts)}–${end.toLocaleTimeString(undefined, timeOpts)}`;
}

export default function AccountCorporatePage() {
  const { data, loading, error } = useCorporateRequests();
  const requests = data ?? [];
  const [tab, setTab] = useState<Tab>("pending");

  const filtered = useMemo(
    () =>
      requests
        .filter((r) => inTab(r, tab))
        .sort((a, b) => b.created_at.localeCompare(a.created_at)),
    [requests, tab],
  );
  const tabs: Tab[] = ["pending", "confirmed", "past", "cancelled"];

  return (
    <>
      {/* AccountShell supplies the column gutters; adding more here squeezed
          the card content on phones. */}
      <div className="max-w-3xl">
        <AccountPageHeader
          title="Corporate packages"
          description="After you request one, the studio arranges the dates, location and instructor with you on WhatsApp. Once it's scheduled, the details appear here."
        />

        {loading && (
          <div className="space-y-3" aria-busy="true" aria-label="Loading your corporate packages">
            <Skeleton className="h-11 rounded-full" />
            <Skeleton className="h-28 rounded-2xl" />
          </div>
        )}

        {!loading && error && (
          <div role="alert" className="rounded-xl border border-warning/30 bg-warning/10 text-ink text-sm px-4 py-3">
            We couldn&apos;t load your corporate packages right now. Please
            refresh in a moment.
          </div>
        )}

        {!loading && !error && (
          <>
            <SegmentedTabs
              label="Corporate packages"
              tabs={tabs.map((t) => ({ value: t, label: TAB_LABEL[t] }))}
              value={tab}
              onChange={setTab}
              counts={Object.fromEntries(tabs.map((t) => [t, requests.filter((r) => inTab(r, t)).length]))}
            />

            <div>
              {filtered.length === 0 ? (
                <div className="rounded-2xl bg-card border border-ink/5 shadow-soft">
                  <EmptyState
                    icon={Building2}
                    title={emptyTitle(tab)}
                    description="Book a session for your team from the corporate packages."
                    cta={{ href: "/packages#corporate", label: "View corporate packages" }}
                  />
                </div>
              ) : (
                <ul className="space-y-3">
                  {filtered.map((r) => (
                    <RequestCard key={r.id} request={r} />
                  ))}
                </ul>
              )}
            </div>
          </>
        )}
      </div>
    </>
  );
}

function RequestCard({ request: r }: { request: ApiCorporateRequest }) {
  const badge = statusBadge(r.status);
  // The studio's own number. A studio that has set none gets no button — see
  // `corporateWhatsappHref`.
  const whatsapp = corporateWhatsappHref(useBrandCopy(WHATSAPP_COPY_KEY, ""), r.package.name);

  return (
    <li className="rounded-2xl border border-ink/5 bg-card shadow-soft p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-semibold text-ink break-words">{r.package.name}</p>
          {r.session ? (
            <>
              <p className="text-sm font-medium text-ink/80 mt-1">
                {formatSessionWindow(r.session.starts_at, r.session.ends_at)}
              </p>
              {(r.session.location_name || r.session.instructor_name) && (
                <p className="text-xs text-muted mt-1">
                  {[r.session.instructor_name, r.session.location_name]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              )}
            </>
          ) : (
            <p className="text-sm text-muted mt-1">
              Not yet scheduled — we&apos;ll arrange the details with you over
              WhatsApp.
            </p>
          )}
        </div>
        <span
          className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${badge.tone}`}
        >
          <badge.icon size={12} /> {badge.label}
        </span>
      </div>

      {r.status === "pending" && whatsapp && (
        <a
          href={whatsapp}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-4 inline-flex w-full sm:w-auto min-h-[44px] items-center justify-center gap-2 rounded-full bg-ink text-paper px-5 text-sm font-semibold hover:bg-ink/90 transition-colors"
        >
          <MessageCircle className="h-4 w-4" strokeWidth={1.8} />
          Arrange on WhatsApp
        </a>
      )}
    </li>
  );
}
