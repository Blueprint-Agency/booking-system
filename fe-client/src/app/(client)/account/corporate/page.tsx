"use client";

import { useMemo, useState } from "react";
import {
  Building2,
  CheckCircle2,
  Clock,
  Loader2,
  MessageCircle,
  XCircle,
} from "lucide-react";
import { SectionHeading } from "@/components/booking/section-heading";
import { EmptyState } from "@/components/ui/empty-state";
import {
  ApiCorporateRequest,
  ApiCorporateRequestStatus,
  corporateWhatsappHref,
  useCorporateRequests,
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
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8 sm:py-10">
        <SectionHeading eyebrow="Corporate" title="Your corporate packages" />

        {loading && (
          <div className="mt-6 flex items-center justify-center py-12 text-muted text-sm">
            <Loader2 className="h-4 w-4 animate-spin mr-2" /> Loading…
          </div>
        )}

        {!loading && error && (
          <div className="mt-6 rounded-xl border border-warning/30 bg-warning/10 text-ink text-sm px-4 py-3 text-center">
            We couldn&apos;t load your corporate packages right now. Please
            refresh in a moment.
          </div>
        )}

        {!loading && !error && (
          <>
            <div className="mt-6 flex flex-wrap gap-2">
              {tabs.map((t) => {
                const count = requests.filter((r) => inTab(r, t)).length;
                return (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setTab(t)}
                    className={`rounded-full border px-3 py-1.5 text-xs transition ${
                      tab === t
                        ? "border-accent bg-accent/10 text-ink"
                        : "border-ink/10 bg-card text-muted hover:text-ink"
                    }`}
                  >
                    {TAB_LABEL[t]} ({count})
                  </button>
                );
              })}
            </div>

            <div className="mt-6">
              {filtered.length === 0 ? (
                <EmptyState
                  icon={Building2}
                  title={emptyTitle(tab)}
                  description="Browse corporate packages to get started."
                  cta={{ href: "/corporate", label: "View packages" }}
                />
              ) : (
                <ul className="space-y-3">
                  {filtered.map((r) => (
                    <RequestCard key={r.id} request={r} />
                  ))}
                </ul>
              )}
            </div>

            <p className="text-xs text-muted mt-10 leading-relaxed">
              After purchasing, message us on WhatsApp to arrange the dates,
              location and instructor. Once scheduled, the details appear here.
            </p>
          </>
        )}
      </div>
    </>
  );
}

function RequestCard({ request: r }: { request: ApiCorporateRequest }) {
  const badge = statusBadge(r.status);

  return (
    <li className="rounded-2xl border border-ink/10 bg-card p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-wider text-muted">
            Corporate
          </p>
          <p className="font-serif text-lg text-ink mt-1">{r.package.name}</p>
          {r.session ? (
            <>
              <p className="text-sm text-ink mt-2">
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
            <p className="text-sm text-muted mt-2">
              Not yet scheduled — we&apos;ll arrange the details with you over
              WhatsApp.
            </p>
          )}
        </div>
        <span
          className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs ${badge.tone}`}
        >
          <badge.icon size={12} /> {badge.label}
        </span>
      </div>

      {r.status === "pending" && (
        <div className="mt-4">
          <a
            href={corporateWhatsappHref(r.package.name)}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center gap-2 rounded-full bg-ink text-paper px-4 py-2 text-sm font-medium hover:bg-ink/90 transition-colors"
          >
            <MessageCircle className="h-4 w-4" strokeWidth={1.5} />
            Arrange on WhatsApp
          </a>
          <p className="text-xs text-muted mt-2">
            We&apos;ll arrange the details with you over WhatsApp.
          </p>
        </div>
      )}
    </li>
  );
}
