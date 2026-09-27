"use client";

/**
 * One card for every booking a member holds — a class, a PT session or
 * request, a workshop, a corporate request — so "Your bookings" reads as one
 * list: the date stub, what kind it is and where it stands, the time, then
 * the details as chips, and the QR and the actions where they apply.
 */
import { useState } from "react";
import {
  CheckCircle2,
  Clock,
  Hourglass,
  MapPin,
  MessageCircle,
  Tag,
  UserRound,
  Users,
  X,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import { QrBadge } from "@/components/account/qr-badge";
import { DateStub } from "@/components/account/date-stub";
import type { ApiBooking } from "@/components/account/class-bookings";
import type { ApiWorkshopBooking } from "@/components/account/workshop-bookings";
import { useBrandCopy } from "@/components/brand/brand-provider";
import { BTN_CANCEL } from "@/components/ui/styles";
import { cn, formatDate } from "@/lib/utils";
import { formatClassTime } from "@/lib/classes";
import type { BookingType } from "@/lib/my-bookings";
import {
  formatSlotRange,
  ptCancelFailure,
  usePtSessionsApi,
  type CancelPtRequestResult,
  type RawPtRequest,
} from "@/lib/pt-sessions";
import { corporateWhatsappHref, WHATSAPP_COPY_KEY, type ApiCorporateRequest } from "@/lib/corporate";
import type { CancellationPolicy } from "@/lib/cancellation-policy";
import {
  canCancelClass,
  cancelClosed,
  cancelDeadlineLine,
  canStillCancel,
  isLate,
  ptCancelPrompt,
} from "@/lib/cancellation-copy";

// ── The shell ────────────────────────────────────────────────────────────────

export const TYPE_LABEL: Record<BookingType, string> = {
  class: "Class",
  pt: "Private",
  workshop: "Workshop",
  corporate: "Corporate",
};

/** Each kind keeps the colour its ticket wears (`next-class-card.tsx`). */
const TYPE_TONE: Record<BookingType, string> = {
  class: "bg-accent/10 text-accent-deep",
  pt: "bg-gold/12 text-gold-deep",
  workshop: "bg-green/12 text-green-deep",
  corporate: "bg-cyan/15 text-cyan-deep",
};

type Tone = "info" | "ok" | "muted" | "bad" | "live";
const STATUS_TONE: Record<Tone, string> = {
  info: "bg-accent/10 text-accent-deep",
  ok: "bg-sage/15 text-sage",
  muted: "bg-ink/[0.06] text-muted",
  bad: "bg-error/12 text-error",
  live: "bg-sage/15 text-sage",
};

interface Status {
  label: string;
  tone: Tone;
  icon?: LucideIcon;
}

interface Chip {
  icon: LucideIcon;
  label: string;
}

function BookingCard({
  type,
  stub,
  stubTone,
  status,
  title,
  when,
  chips,
  qr,
  code,
  action,
  highlight,
  children,
}: {
  type: BookingType;
  stub: string | null;
  stubTone: "default" | "accent" | "muted";
  status?: Status | null;
  title: string;
  when?: React.ReactNode;
  /** Falsy entries (a detail the booking lacks) are skipped. */
  chips: (Chip | null | false | "" | undefined)[];
  qr?: { value: string; label: string; subLabel: string } | null;
  /** The check-in code, in the footer beside the action. */
  code?: string | null;
  action?: React.ReactNode;
  highlight?: boolean;
  children?: React.ReactNode;
}) {
  const shown = chips.filter(Boolean) as Chip[];
  return (
    <li
      className={cn(
        "list-none rounded-2xl bg-card border shadow-soft",
        highlight ? "border-accent/25" : "border-ink/5",
      )}
    >
      <div className="flex items-start gap-3 p-4 sm:gap-4">
        <DateStub iso={stub} tone={stubTone} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span
              className={cn(
                "inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider",
                TYPE_TONE[type],
              )}
            >
              {TYPE_LABEL[type]}
            </span>
            {status && (
              <span
                className={cn(
                  "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider",
                  STATUS_TONE[status.tone],
                )}
              >
                {status.tone === "live" ? (
                  <span className="h-1.5 w-1.5 rounded-full bg-sage animate-pulse" aria-hidden />
                ) : (
                  status.icon && <status.icon className="h-3 w-3" aria-hidden />
                )}
                {status.label}
              </span>
            )}
          </div>
          <p className="mt-1.5 font-semibold leading-snug text-ink break-words">{title}</p>
          {when && <p className="mt-0.5 text-sm font-medium text-ink/80 tabular-nums">{when}</p>}
          {shown.length > 0 && (
            <ul className="mt-2 flex flex-wrap gap-1.5">
              {shown.map((c) => (
                <li
                  key={c.label}
                  className="inline-flex max-w-full items-center gap-1 rounded-full border border-ink/10 bg-ink/[0.03] px-2 py-0.5 text-xs font-medium text-ink"
                >
                  <c.icon className="h-3 w-3 shrink-0 text-ink/40" aria-hidden />
                  <span className="truncate">{c.label}</span>
                </li>
              ))}
            </ul>
          )}
          {children}
        </div>
        {qr && <QrBadge value={qr.value} label={qr.label} subLabel={qr.subLabel} />}
      </div>
      {(code || action) && (
        <div className="flex min-h-[52px] flex-wrap items-center justify-between gap-2 border-t border-ink/5 px-4 py-1.5">
          <span className="font-mono text-xs tracking-wide text-muted">{code}</span>
          {action}
        </div>
      )}
    </li>
  );
}

const timeRange = (start: string, end: string) => `${formatClassTime(start)} – ${formatClassTime(end)}`;

// ── Class ────────────────────────────────────────────────────────────────────

export function ClassBookingCard({
  booking: b,
  ongoing,
  onCancel,
}: {
  booking: ApiBooking;
  ongoing: boolean;
  onCancel: (b: ApiBooking) => void;
}) {
  const past = !ongoing && !canCancelClass(b.starts_at);
  const cancelled = b.state === "cancelled";
  const attended = b.check_in_state === "attended";
  const noShow = b.check_in_state === "no_show" || b.state === "no_show";
  // Cancellable until it starts; inside its window it is a late cancel.
  const open = !cancelled && canCancelClass(b.starts_at);
  const deadline = `${formatDate(b.cancel_deadline)} · ${formatClassTime(b.cancel_deadline)}`;

  const status: Status | null = cancelled
    ? { label: "Cancelled", tone: "muted", icon: XCircle }
    : attended
      ? { label: "Checked in", tone: "ok", icon: CheckCircle2 }
      : ongoing
        ? { label: "In progress", tone: "live" }
        : noShow
          ? { label: "No-show", tone: "muted", icon: XCircle }
          : past
            ? null
            : { label: "Booked", tone: "ok", icon: CheckCircle2 };

  return (
    <BookingCard
      type="class"
      stub={b.starts_at}
      stubTone={past || cancelled ? "muted" : ongoing ? "accent" : "default"}
      status={status}
      title={b.name}
      when={timeRange(b.starts_at, b.ends_at)}
      chips={[
        b.instructor && { icon: UserRound, label: b.instructor.name },
        b.location && { icon: MapPin, label: b.location.name },
      ]}
      qr={
        past || cancelled
          ? null
          : { value: b.qr_token, label: b.name, subLabel: `${formatDate(b.starts_at)} · ${b.code}` }
      }
      code={past || cancelled ? null : b.code}
      highlight={ongoing}
      action={
        open && (
          <button type="button" onClick={() => onCancel(b)} className={cn(BTN_CANCEL, "-mr-1")}>
            <X className="h-4 w-4" aria-hidden />
            Cancel
          </button>
        )
      }
    >
      {open && (
        <p className="mt-2 text-xs text-muted">{cancelDeadlineLine(isLate(b.cancel_deadline), deadline)}</p>
      )}
    </BookingCard>
  );
}

// ── PT ───────────────────────────────────────────────────────────────────────

function ptStatus(r: RawPtRequest): Status {
  switch (r.status) {
    case "pending":
      return { label: "Pending", tone: "info", icon: Clock };
    case "scheduled":
      return { label: "Confirmed", tone: "ok", icon: CheckCircle2 };
    case "attended":
      return { label: "Attended", tone: "ok", icon: CheckCircle2 };
    case "cancelled_after_scheduled":
      if (r.refund_outcome === "forfeited") return { label: "Cancelled · session lost", tone: "bad", icon: XCircle };
      if (r.refund_outcome === "session_returned")
        return { label: "Cancelled · session returned", tone: "muted", icon: XCircle };
      return { label: "Cancelled", tone: "muted", icon: XCircle };
    default:
      return { label: "Cancelled · session returned", tone: "muted", icon: XCircle };
  }
}

export function PtBookingCard({
  request: r,
  policy,
  onCancelled,
}: {
  request: RawPtRequest;
  policy: CancellationPolicy | null;
  onCancelled: (result: CancelPtRequestResult) => Promise<void>;
}) {
  const scheduled = r.session ?? null;
  const slot0 = r.slots[0];
  const isPartner = r.role === "partner";
  const kind = r.session_type === "1on1" ? "1-on-1" : "2-on-1";
  const live = r.status === "pending" || r.status === "scheduled";
  // Only the requester (who owns the debited sessions) can cancel. A scheduled
  // session closes to members at the studio's PT window — the server refuses
  // after that, so the button goes before it would.
  const windowClosed =
    r.status === "scheduled" && !!scheduled && !!policy && !canStillCancel(scheduled.starts_at, policy.pt_window_hours);
  const canCancel = !isPartner && live;

  const when = scheduled ? (
    timeRange(scheduled.starts_at, scheduled.ends_at)
  ) : slot0 ? (
    <>
      {formatSlotRange(slot0)}
      {r.slots.length > 1 && <span className="ml-1.5 text-xs font-normal text-muted">+{r.slots.length - 1} more</span>}
    </>
  ) : null;

  return (
    <BookingCard
      type="pt"
      stub={scheduled ? scheduled.starts_at : slot0 ? `${slot0.proposed_date.slice(0, 10)}T12:00:00+08:00` : null}
      stubTone={r.status === "scheduled" ? "default" : r.status === "pending" ? "default" : "muted"}
      status={ptStatus(r)}
      title={`${kind} · ${r.class_name ?? "Any class type"}`}
      when={when}
      chips={[
        scheduled?.instructor_name && { icon: UserRound, label: scheduled.instructor_name },
        r.location_name && { icon: MapPin, label: r.location_name },
        scheduled?.room_name && { icon: Tag, label: scheduled.room_name },
        isPartner
          ? { icon: Users, label: `Hosted by ${r.host_name ?? "the host"}` }
          : r.co_client_name && { icon: Users, label: `With ${r.co_client_name}` },
      ]}
      qr={
        scheduled && r.booking && r.status === "scheduled"
          ? { value: r.booking.qr_token, label: `${kind} session`, subLabel: `${formatDate(scheduled.starts_at)} · ${r.booking.code}` }
          : null
      }
      code={r.status === "scheduled" ? r.booking?.code : null}
      action={
        canCancel &&
        (windowClosed && policy ? (
          <span className="text-xs text-muted">{cancelClosed(policy.pt_window_hours)}</span>
        ) : (
          <PtCancel
            requestId={r.id}
            label={r.status === "pending" ? "Cancel request" : "Cancel"}
            prompt={ptCancelPrompt(r.status === "pending" ? "pending" : "scheduled", policy)}
            windowHours={policy?.pt_window_hours ?? null}
            onCancelled={onCancelled}
          />
        ))
      }
    >
      {r.message && (
        <blockquote className="mt-2 rounded-lg bg-ink/[0.04] px-3 py-1.5 text-xs italic text-muted">{r.message}</blockquote>
      )}
      {r.status === "pending" && r.slots.length > 1 && (
        <details className="mt-1">
          <summary className="cursor-pointer py-1.5 text-xs font-semibold text-accent-deep hover:text-accent">
            All proposed times
          </summary>
          <ul className="mt-1 space-y-0.5 text-xs text-muted">
            {r.slots.map((s, i) => (
              <li key={i}>
                {formatDate(s.proposed_date)} · {formatSlotRange(s)}
              </li>
            ))}
          </ul>
        </details>
      )}
    </BookingCard>
  );
}

/** Cancel a PT request or session, asked in place before it is sent. */
function PtCancel({
  requestId,
  label,
  prompt,
  windowHours,
  onCancelled,
}: {
  requestId: string;
  label: string;
  prompt: string;
  windowHours: number | null;
  onCancelled: (result: CancelPtRequestResult) => Promise<void>;
}) {
  const ptApi = usePtSessionsApi();
  const [confirming, setConfirming] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);

  async function handleCancel() {
    setCancelling(true);
    setCancelError(null);
    let result: CancelPtRequestResult;
    try {
      result = await ptApi.cancelRequest(requestId);
    } catch (err) {
      setCancelError(ptCancelFailure(err, windowHours));
      setCancelling(false);
      setConfirming(false);
      return;
    }
    await onCancelled(result);
  }

  if (cancelError) return <span className="text-xs text-error">{cancelError}</span>;

  if (!confirming) {
    return (
      <button type="button" onClick={() => setConfirming(true)} className={cn(BTN_CANCEL, "-mr-1")}>
        <X className="h-4 w-4" aria-hidden />
        {label}
      </button>
    );
  }

  return (
    <div className="flex w-full flex-col gap-2 py-1.5 text-sm sm:flex-row sm:items-center">
      <span className="text-muted sm:flex-1">{prompt}</span>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setConfirming(false)}
          disabled={cancelling}
          className="flex-1 min-h-[40px] rounded-full border border-ink/10 px-4 font-semibold text-ink hover:border-ink/30 disabled:opacity-50 sm:flex-none"
        >
          Keep
        </button>
        <button
          type="button"
          onClick={handleCancel}
          disabled={cancelling}
          className="flex-1 min-h-[40px] rounded-full bg-error px-4 font-semibold text-inverse hover:bg-error/90 disabled:opacity-50 sm:flex-none"
        >
          {cancelling ? "Cancelling…" : "Confirm cancellation"}
        </button>
      </div>
    </div>
  );
}

// ── Workshop ─────────────────────────────────────────────────────────────────

function workshopWhen(b: ApiWorkshopBooking): string {
  if (!b.starts_at) return "Dates to be announced";
  if (b.ends_at && formatDate(b.starts_at) !== formatDate(b.ends_at)) {
    return `${formatDate(b.starts_at)} – ${formatDate(b.ends_at)}`;
  }
  return b.ends_at ? timeRange(b.starts_at, b.ends_at) : formatClassTime(b.starts_at);
}

export function WorkshopBookingCard({ booking: b, phase }: { booking: ApiWorkshopBooking; phase: "upcoming" | "ongoing" | "past" }) {
  const cancelled = b.state === "cancelled";
  const past = phase === "past";
  const status: Status | null = cancelled
    ? { label: "Cancelled", tone: "muted", icon: XCircle }
    : b.check_in_state === "attended"
      ? { label: "Attended", tone: "ok", icon: CheckCircle2 }
      : b.check_in_state === "no_show"
        ? { label: "No-show", tone: "muted", icon: XCircle }
        : phase === "ongoing"
          ? { label: "In progress", tone: "live" }
          : past
            ? null
            : { label: "Booked", tone: "ok", icon: CheckCircle2 };
  return (
    <BookingCard
      type="workshop"
      stub={b.starts_at}
      stubTone={past ? "muted" : phase === "ongoing" ? "accent" : "default"}
      status={status}
      title={b.workshop_name}
      when={workshopWhen(b)}
      chips={[b.tier_name && { icon: Tag, label: b.tier_name }, b.location && { icon: MapPin, label: b.location.name }]}
      qr={past ? null : { value: b.qr_token, label: b.workshop_name, subLabel: `${workshopWhen(b)} · ${b.code}` }}
      code={past ? null : b.code}
    >
      {/* No self-serve cancel: the studio arranges changes and refunds (#272). */}
      {!past && <p className="mt-2 text-xs text-muted">To change or cancel, contact the studio.</p>}
      {cancelled && (
        <p className="mt-2 text-xs text-muted">Any refund is arranged by the studio and shows on your card statement.</p>
      )}
    </BookingCard>
  );
}

// ── Corporate ────────────────────────────────────────────────────────────────

function corporateStatus(r: ApiCorporateRequest): Status {
  switch (r.status) {
    case "pending":
      return { label: "Pending", tone: "info", icon: Clock };
    case "scheduled":
      return { label: "Confirmed", tone: "ok", icon: CheckCircle2 };
    case "attended":
      return { label: "Done", tone: "ok", icon: CheckCircle2 };
    case "cancelled":
      return { label: "Cancelled", tone: "muted", icon: XCircle };
  }
}

export function CorporateBookingCard({ request: r }: { request: ApiCorporateRequest }) {
  // The studio's own number. A studio that has set none gets no button.
  const whatsapp = corporateWhatsappHref(useBrandCopy(WHATSAPP_COPY_KEY, ""), r.package.name);
  const s = r.session;
  return (
    <BookingCard
      type="corporate"
      stub={s?.starts_at ?? null}
      stubTone={r.status === "pending" || r.status === "scheduled" ? "default" : "muted"}
      status={corporateStatus(r)}
      title={r.package.name}
      when={s ? timeRange(s.starts_at, s.ends_at) : null}
      chips={[
        s?.instructor_name && { icon: UserRound, label: s.instructor_name },
        s?.location_name && { icon: MapPin, label: s.location_name },
        !s && r.status === "pending" && { icon: Hourglass, label: "Not scheduled yet" },
      ]}
      action={
        r.status === "pending" &&
        whatsapp && (
          <a
            href={whatsapp}
            target="_blank"
            rel="noopener noreferrer"
            className="-mr-1 inline-flex min-h-[40px] items-center gap-1.5 rounded-full bg-ink px-4 text-sm font-semibold text-paper hover:bg-ink/90 transition-colors"
          >
            <MessageCircle className="h-4 w-4" aria-hidden />
            Arrange on WhatsApp
          </a>
        )
      }
    >
      {r.status === "pending" && (
        <p className="mt-2 text-xs text-muted">We&apos;ll arrange the date, place and instructor with you on WhatsApp.</p>
      )}
    </BookingCard>
  );
}
