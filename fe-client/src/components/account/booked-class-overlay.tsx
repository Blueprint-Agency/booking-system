"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, DoorOpen, ExternalLink, Hash, Hourglass, Loader2, MapPin, Ticket, UserRound, X } from "lucide-react";
import type { ApiBooking } from "@/components/account/class-bookings";
import { Fact } from "@/components/booking/class-detail-overlay";
import { Portal } from "@/components/ui/portal";
import {
  BTN_CANCEL,
  BTN_SECONDARY,
  OVERLAY_ACTIONS,
  OVERLAY_BACKDROP_CENTRED,
  OVERLAY_BODY,
  OVERLAY_HEADER,
  OVERLAY_PANEL_CENTRED,
} from "@/components/ui/styles";
import {
  canCancelClass,
  cancelDeadlineLine,
  cancelledStanding,
  isLate,
} from "@/lib/cancellation-copy";
import { classLength } from "@/lib/class-detail";
import { fetchPublicClass, formatClassTime, type ApiClassDetail } from "@/lib/classes";
import { credits } from "@/lib/package-picker";
import { useBodyScrollLock } from "@/lib/use-body-scroll-lock";
import { useFocusTrap } from "@/lib/use-focus-trap";
import { cn, formatDate } from "@/lib/utils";

/** Where the member stands in this class, in the words the schedule's overlay uses. */
function standing(b: ApiBooking, ongoing: boolean): { text: string; tone: "ok" | "muted" } | null {
  // A whole-class cancel, a staff cancel, a Void and a Package rule change are the studio's (#349).
  if (b.state === "cancelled") return { text: cancelledStanding(b.cancelled_by ?? "studio"), tone: "muted" };
  if (b.check_in_state === "attended") return { text: "You checked in to this class", tone: "ok" };
  if (b.check_in_state === "no_show") return { text: "Marked as a no-show", tone: "muted" };
  if (ongoing) return { text: "This class is on now", tone: "ok" };
  if (canCancelClass(b.starts_at)) return { text: "You're booked into this class", tone: "ok" };
  return null;
}

/**
 * A class the member booked, opened from its card on My bookings or a day of
 * My activity: the schedule's class detail (`ClassDetailOverlay`) — the class
 * type's description, who teaches it, where — with the member's own booking
 * in place of seats and packages: what they paid, the cancel deadline while
 * it is open, and the check-in code. The class is read from
 * `GET /public/classes/:id`, which serves one that has already run.
 */
export function BookedClassOverlay({
  booking: b,
  ongoing,
  onCancel,
  onClose,
}: {
  booking: ApiBooking;
  ongoing: boolean;
  /** Cancel this booking: the card's own Cancel, asked here too. */
  onCancel: (b: ApiBooking) => void;
  onClose: () => void;
}) {
  const trapRef = useFocusTrap<HTMLDivElement>(true);
  useBodyScrollLock(true);
  const [detail, setDetail] = useState<ApiClassDetail | null>(null);
  const [failed, setFailed] = useState(false);
  const titleId = `booked-class-${b.booking_id}`;

  const read = useCallback(
    async (isCancelled: () => boolean) => {
      setFailed(false);
      try {
        const d = await fetchPublicClass(b.class_id);
        if (!isCancelled()) setDetail(d);
      } catch {
        if (!isCancelled()) setFailed(true);
      }
    },
    [b.class_id],
  );

  useEffect(() => {
    let cancelled = false;
    void read(() => cancelled);
    return () => {
      cancelled = true;
    };
  }, [read]);

  const cancelled = b.state === "cancelled";
  const open = !cancelled && canCancelClass(b.starts_at);
  const live = !cancelled && (open || ongoing);
  const state = standing(b, ongoing);
  const location = detail?.location ?? null;
  const supporting = detail?.supporting_instructors ?? [];
  const deadline = `${formatDate(b.cancel_deadline)} · ${formatClassTime(b.cancel_deadline)}`;

  return (
    <Portal>
      <div className={OVERLAY_BACKDROP_CENTRED} onClick={onClose}>
        <div
          ref={trapRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          tabIndex={-1}
          className={OVERLAY_PANEL_CENTRED}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.key === "Escape" && onClose()}
        >
          <header className={OVERLAY_HEADER}>
            <div className="min-w-0 flex-1">
              <h2 id={titleId} className="text-xl font-bold leading-snug text-ink break-words">
                {b.name}
              </h2>
              <p className="mt-1 text-sm font-medium text-ink/80 tabular-nums">
                {formatDate(b.starts_at)} · {formatClassTime(b.starts_at)} – {formatClassTime(b.ends_at)}
                <span className="text-muted"> · {classLength(b.starts_at, b.ends_at)}</span>
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="-mr-2 -mt-1 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-muted hover:bg-ink/5 hover:text-ink transition-colors"
            >
              <X className="h-5 w-5" aria-hidden />
            </button>
          </header>

          <div className={OVERLAY_BODY}>
            {state && (
              <p
                className={cn(
                  "mb-4 inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-semibold",
                  state.tone === "ok" ? "bg-sage/15 text-sage" : "bg-ink/[0.06] text-muted",
                )}
              >
                {state.tone === "ok" && <Check className="h-4 w-4" aria-hidden />}
                {state.text}
              </p>
            )}

            {failed ? (
              <div className="rounded-xl border border-error/30 bg-error/10 px-4 py-3 text-sm text-error" role="alert">
                We couldn&apos;t load this class&apos;s details.{" "}
                <button
                  type="button"
                  onClick={() => void read(() => false)}
                  className="font-medium underline underline-offset-2"
                >
                  Try again
                </button>
              </div>
            ) : !detail ? (
              <p className="inline-flex items-center gap-2 text-sm text-muted" role="status">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                Loading class details…
              </p>
            ) : (
              detail.class_type.description && (
                <p className="whitespace-pre-line text-sm leading-relaxed text-ink/80">{detail.class_type.description}</p>
              )
            )}

            <dl className="mt-5 grid gap-x-6 gap-y-4 sm:grid-cols-2">
              {b.instructor && (
                <Fact icon={<UserRound />} label="Instructor">
                  {b.instructor.name}
                  {supporting.length > 0 && (
                    <span className="block text-muted">with {supporting.map((s) => s.name).join(", ")}</span>
                  )}
                </Fact>
              )}
              {b.location && (
                <Fact icon={<MapPin />} label="Location">
                  {b.location.name}
                  {location?.address && <span className="block text-muted">{location.address}</span>}
                  {location?.gmaps_url && (
                    <a
                      href={location.gmaps_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-0.5 inline-flex items-center gap-1 text-accent-deep underline underline-offset-2 hover:text-ink transition-colors"
                    >
                      Open in Maps
                      <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                    </a>
                  )}
                </Fact>
              )}
              {b.room && (
                <Fact icon={<DoorOpen />} label="Room">
                  {b.room.name}
                </Fact>
              )}
              <Fact icon={<Ticket />} label="Paid with">
                <span className="tabular-nums">{b.was_unlimited ? "Unlimited" : credits(b.credits_used)}</span>
              </Fact>
              {open && (
                <Fact icon={<Hourglass />} label="Cancellation">
                  {cancelDeadlineLine(isLate(b.cancel_deadline), deadline)}
                </Fact>
              )}
              {cancelled && b.outcome_line && (
                <Fact icon={<Hourglass />} label="Cancellation">
                  {b.outcome_line}
                  {b.cancelled_at && (
                    <span className="block text-muted tabular-nums">
                      {formatDate(b.cancelled_at)} · {formatClassTime(b.cancelled_at)}
                    </span>
                  )}
                </Fact>
              )}
              {live && (
                <Fact icon={<Hash />} label="Check-in code">
                  <span className="font-mono tracking-wide">{b.code}</span>
                </Fact>
              )}
            </dl>
          </div>

          <div className={OVERLAY_ACTIONS}>
            <button type="button" onClick={onClose} className={BTN_SECONDARY}>
              Close
            </button>
            {open && (
              <button type="button" onClick={() => onCancel(b)} className={cn(BTN_CANCEL, "justify-center")}>
                <X className="h-4 w-4" aria-hidden />
                Cancel booking
              </button>
            )}
          </div>
        </div>
      </div>
    </Portal>
  );
}
