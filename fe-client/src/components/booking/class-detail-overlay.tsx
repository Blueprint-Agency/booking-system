"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import {
  CalendarX,
  Check,
  CircleCheck,
  CircleMinus,
  DoorOpen,
  ExternalLink,
  Hourglass,
  Loader2,
  Lock,
  MapPin,
  Ticket,
  UserRound,
  Users,
  X,
} from "lucide-react";
import { Portal } from "@/components/ui/portal";
import {
  BTN_BOOK,
  BTN_PRIMARY,
  BTN_SECONDARY,
  OVERLAY_ACTIONS,
  OVERLAY_BACKDROP,
  OVERLAY_BODY,
  OVERLAY_HEADER,
  OVERLAY_PANEL,
} from "@/components/ui/styles";
import { cn, formatDate } from "@/lib/utils";
import { apiErrorCode, useApi } from "@/lib/api";
import { ERROR_CODES } from "@/lib/error-codes";
import {
  fetchMemberClass,
  fetchPublicClass,
  formatClassTime,
  type ApiClassCard,
  type ApiClassDetail,
  type ApiMemberClassDetail,
} from "@/lib/classes";
import { classLength, seatsLine } from "@/lib/class-detail";
import { classCancelWindowLine } from "@/lib/cancellation-copy";
import { acceptsNone, credits, packageMeta, reasonText } from "@/lib/package-picker";
import { ruleSentence } from "@/lib/package-rule";
import { useBodyScrollLock } from "@/lib/use-body-scroll-lock";
import { useFocusTrap } from "@/lib/use-focus-trap";
import type { ClassAction, WaitlistPlace } from "@/lib/waitlist";
import { clashNote, type ApiClash } from "@/lib/clash";

type Load =
  | { state: "loading" }
  | { state: "error"; msg: string }
  | { state: "ready"; detail: ApiClassDetail | ApiMemberClassDetail };

const isMemberDetail = (d: ApiClassDetail | ApiMemberClassDetail): d is ApiMemberClassDetail =>
  Array.isArray((d as ApiMemberClassDetail).my_packages);

/**
 * Everything about one class, opened by tapping its row on the schedule
 * (fe-client-features §3.1): what it is, when and how long, who teaches it,
 * where, what it costs, where its seats stand, how late it can be cancelled,
 * and which packages it takes — with, for a signed-in member, each of their
 * own class packages ticked or marked with the reason it cannot pay.
 *
 * The row's card is enough to open on; the rest is read for this class when
 * the overlay opens (`/me/classes/:id` signed in, `/public/classes/:id`
 * signed out), so the schedule itself stays anonymous and cheap. What the
 * member can do here is the row's own action: Book opens the same picker the
 * row's Book button does, and the seat state is the row's, so the two never
 * disagree.
 */
export function ClassDetailOverlay({
  cls,
  isSignedIn,
  action,
  clash,
  hasSeats,
  waitlistOpen,
  myEntry,
  joining,
  onBook,
  onJoinWaitlist,
  onNoneAccepted,
  onClose,
}: {
  cls: ApiClassCard;
  isSignedIn: boolean;
  /** The row's button, as `classAction` decided it. */
  action: ClassAction;
  /** The member's own booking this class overlaps, as the row last knew it. */
  clash: ApiClash | null;
  /** An online seat is free, as the row last knew it. */
  hasSeats: boolean;
  waitlistOpen: boolean;
  myEntry: WaitlistPlace | null;
  joining: boolean;
  onBook: () => void;
  onJoinWaitlist: () => void;
  /** The class takes none of the member's packages: the row stops offering Book. */
  onNoneAccepted: () => void;
  onClose: () => void;
}) {
  const trapRef = useFocusTrap<HTMLDivElement>(true);
  useBodyScrollLock(true);
  const api = useApi();
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const titleId = `class-detail-${cls.id}`;
  // Held in a ref: the row hands a fresh function each render, and reading the
  // class again for that would loop.
  const noneAccepted = useRef(onNoneAccepted);
  useEffect(() => {
    noneAccepted.current = onNoneAccepted;
  });

  const read = useCallback(
    async (isCancelled: () => boolean) => {
      setLoad({ state: "loading" });
      try {
        const detail = isSignedIn ? await fetchMemberClass(api, cls.id) : await fetchPublicClass(cls.id);
        if (isCancelled()) return;
        setLoad({ state: "ready", detail });
        if (isMemberDetail(detail) && acceptsNone(detail.my_packages)) noneAccepted.current();
      } catch (err) {
        if (isCancelled()) return;
        setLoad({
          state: "error",
          msg:
            apiErrorCode(err) === ERROR_CODES.class_not_found
              ? "This class is no longer running."
              : "We couldn't load this class's details.",
        });
      }
    },
    [api, cls.id, isSignedIn],
  );

  useEffect(() => {
    let cancelled = false;
    void read(() => cancelled);
    return () => {
      cancelled = true;
    };
  }, [read]);

  const detail = load.state === "ready" ? load.detail : null;
  const location = detail?.location ?? cls.location;
  const gmapsUrl = detail?.location?.gmaps_url ?? null;
  const supporting = detail?.supporting_instructors ?? [];
  const windowHours = detail?.effective_cancel_window_hours ?? cls.effective_cancel_window_hours;
  const seats = seatsLine(hasSeats, { enabled: cls.waitlist.enabled, open: waitlistOpen });

  return (
    <Portal>
      <div className={OVERLAY_BACKDROP} onClick={onClose}>
        <div
          ref={trapRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          tabIndex={-1}
          className={OVERLAY_PANEL}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.key === "Escape" && onClose()}
        >
          <header className={OVERLAY_HEADER}>
            <div className="min-w-0 flex-1">
              <h2 id={titleId} className="text-xl font-bold leading-snug text-ink break-words">
                {cls.class_type.name}
              </h2>
              <p className="mt-1 text-sm font-medium text-ink/80 tabular-nums">
                {formatDate(cls.starts_at)} · {formatClassTime(cls.starts_at)} – {formatClassTime(cls.ends_at)}
                <span className="text-muted"> · {classLength(cls.starts_at, cls.ends_at)}</span>
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
            <StateBanner action={action} myEntry={myEntry} clash={clash} />

            {load.state === "loading" ? (
              <p className="inline-flex items-center gap-2 text-sm text-muted" role="status">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                Loading class details…
              </p>
            ) : load.state === "error" ? (
              <div className="rounded-xl border border-error/30 bg-error/10 px-4 py-3 text-sm text-error" role="alert">
                {load.msg}{" "}
                <button
                  type="button"
                  onClick={() => void read(() => false)}
                  className="font-medium underline underline-offset-2"
                >
                  Try again
                </button>
              </div>
            ) : (
              detail?.class_type.description && (
                <p className="whitespace-pre-line text-sm leading-relaxed text-ink/80">
                  {detail.class_type.description}
                </p>
              )
            )}

            <dl className="mt-5 grid gap-x-6 gap-y-4 sm:grid-cols-2">
              <Fact icon={<UserRound />} label="Instructor">
                {cls.instructor.name}
                {supporting.length > 0 && (
                  <span className="block text-muted">with {supporting.map((s) => s.name).join(", ")}</span>
                )}
              </Fact>
              {location && (
                <Fact icon={<MapPin />} label="Location">
                  {location.name}
                  {location.address && <span className="block text-muted">{location.address}</span>}
                  {gmapsUrl && (
                    <a
                      href={gmapsUrl}
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
              {cls.room && (
                <Fact icon={<DoorOpen />} label="Room">
                  {cls.room.name}
                </Fact>
              )}
              <Fact icon={<Ticket />} label="Cost">
                <span className="tabular-nums">{credits(cls.credit_cost)}</span>
              </Fact>
              <Fact icon={<Users />} label="Availability">
                {seats}
              </Fact>
              <Fact icon={<Hourglass />} label="Cancellation">
                {classCancelWindowLine(windowHours)}
              </Fact>
            </dl>

            {/* Read with the detail: the list states only that a rule exists. */}
            {detail && (
              <section aria-labelledby={`${titleId}-packages`} className="mt-6 border-t border-ink/5 pt-5">
                <h3 id={`${titleId}-packages`} className="text-sm font-semibold text-ink">
                  Packages
                </h3>
                <p className="mt-1 text-sm text-ink">
                  <span className="text-muted">Accepts: </span>
                  {ruleSentence(detail.package_rule)}
                </p>
                <MyPackages detail={detail} isSignedIn={isSignedIn} />
              </section>
            )}
          </div>

          <div className={OVERLAY_ACTIONS}>
            <button type="button" onClick={onClose} className={BTN_SECONDARY}>
              Close
            </button>
            <PrimaryAction action={action} joining={joining} onBook={onBook} onJoinWaitlist={onJoinWaitlist} />
          </div>
        </div>
      </div>
    </Portal>
  );
}

/** One labelled fact about the class, with its icon. Booked-class detail on My bookings wears the same. */
export function Fact({ icon, label, children }: { icon: ReactNode; label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 gap-3">
      <span aria-hidden className="mt-0.5 shrink-0 text-ink/30 [&>svg]:h-4 [&>svg]:w-4">
        {icon}
      </span>
      <div className="min-w-0">
        <dt className="text-xs font-medium text-muted">{label}</dt>
        <dd className="text-sm text-ink break-words">{children}</dd>
      </div>
    </div>
  );
}

/** The member's own standing in this class, where they have one. */
function StateBanner({
  action,
  myEntry,
  clash,
}: {
  action: ClassAction;
  myEntry: WaitlistPlace | null;
  clash: ApiClash | null;
}) {
  if (action === "clash" && clash) {
    return (
      <p className="mb-4 flex items-start gap-2 rounded-xl bg-ink/[0.04] px-4 py-3 text-sm text-ink">
        <CalendarX className="mt-0.5 h-4 w-4 shrink-0 text-muted" aria-hidden />
        <span>{clashNote(clash)}</span>
      </p>
    );
  }
  if (action === "booked") {
    return (
      <p className="mb-4 inline-flex items-center gap-1.5 rounded-full bg-sage/15 px-3 py-1.5 text-sm font-semibold text-sage">
        <Check className="h-4 w-4" aria-hidden />
        You&apos;re booked into this class
      </p>
    );
  }
  if (action === "waitlisted" && myEntry) {
    return (
      <p className="mb-4 inline-flex items-center rounded-full bg-warning/15 px-3 py-1.5 text-sm font-semibold text-ink">
        You&apos;re #{myEntry.position} on the waitlist
      </p>
    );
  }
  return null;
}

/**
 * Signed in: each of the member's class packages, ticked where it can pay for
 * this class, else with the reason it cannot — the Book sheet's own words.
 * Signed out: what signing in would show.
 */
function MyPackages({ detail, isSignedIn }: { detail: ApiClassDetail | ApiMemberClassDetail; isSignedIn: boolean }) {
  if (!isSignedIn || !isMemberDetail(detail)) {
    return (
      <p className="mt-3 rounded-xl bg-ink/[0.04] px-4 py-3 text-sm text-ink">
        <Link href={`/login?next=${encodeURIComponent("/")}`} className="font-semibold underline underline-offset-2">
          Sign in
        </Link>{" "}
        to see which of your packages can pay for this class.
      </p>
    );
  }
  if (detail.my_packages.length === 0) {
    return (
      <p className="mt-3 rounded-xl bg-ink/[0.04] px-4 py-3 text-sm text-ink">
        You don&apos;t hold a class package yet.{" "}
        <Link href="/packages" className="font-semibold underline underline-offset-2">
          See packages
        </Link>
      </p>
    );
  }
  return (
    <ul className="mt-3 space-y-2" aria-label="Your packages">
      {detail.my_packages.map((p) => {
        const reason = reasonText(p);
        return (
          <li
            key={p.id}
            className={cn(
              "flex items-start gap-3 rounded-xl border px-4 py-3",
              p.eligible ? "border-sage/30 bg-sage/[0.06]" : "border-ink/10",
            )}
          >
            {p.eligible ? (
              <CircleCheck role="img" className="mt-0.5 h-4 w-4 shrink-0 text-sage" aria-label="Can pay" />
            ) : (
              <CircleMinus role="img" className="mt-0.5 h-4 w-4 shrink-0 text-muted" aria-label="Can't pay" />
            )}
            <span className="min-w-0">
              <span className={cn("block text-sm font-medium break-words", p.eligible ? "text-ink" : "text-ink/70")}>
                {p.name}
              </span>
              <span className="block text-xs text-muted">{packageMeta(p)}</span>
              {reason && <span className="mt-0.5 block text-xs text-ink/70">{reason}</span>}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/** The row's own action, at the foot of the overlay. */
function PrimaryAction({
  action,
  joining,
  onBook,
  onJoinWaitlist,
}: {
  action: ClassAction;
  joining: boolean;
  onBook: () => void;
  onJoinWaitlist: () => void;
}) {
  switch (action) {
    case "book":
      return (
        <button type="button" onClick={onBook} className={BTN_BOOK}>
          Book Now
        </button>
      );
    case "join_waitlist":
      return (
        <button type="button" onClick={onJoinWaitlist} disabled={joining} className={BTN_PRIMARY}>
          {joining && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
          {joining ? "Joining…" : "Join waitlist"}
        </button>
      );
    case "booked":
    case "waitlisted":
    // The way through a clash is the other booking, in My bookings.
    case "clash":
      return (
        <Link href="/account/bookings?type=class" className={BTN_PRIMARY}>
          My bookings
        </Link>
      );
    case "not_accepted":
      return (
        <Link href="/packages" className={BTN_PRIMARY}>
          See packages
        </Link>
      );
    case "not_covered":
      return (
        <button type="button" disabled className={BTN_PRIMARY}>
          <Lock className="h-4 w-4" aria-hidden />
          Not in plan
        </button>
      );
    case "full":
      return (
        <button type="button" disabled className={BTN_PRIMARY}>
          Full
        </button>
      );
  }
}
