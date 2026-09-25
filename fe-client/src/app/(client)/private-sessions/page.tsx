"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Plus, Trash2, CheckCircle2, AlertCircle } from "lucide-react";
import { BookingSurface } from "@/components/booking/booking-surface";
import { SectionHeading } from "@/components/booking/section-heading";
import { ScheduleSegments } from "@/components/booking/schedule-segments";
import { Skeleton } from "@/components/ui/skeleton";
import { useClientPackages } from "@/lib/use-client-packages";
import { useLocations, useClassTypes } from "@/lib/classes";
import { usePtSessionsApi } from "@/lib/pt-sessions";
import { ApiError } from "@/lib/api";
import { ERROR_CODES } from "@/lib/error-codes";
import { formatDate } from "@/lib/utils";

type Slot = { proposedDate: string; startTime: string; endTime: string };

function apiErrorCode(err: unknown): string | null {
  if (!(err instanceof ApiError)) return null;
  if (!err.body || typeof err.body !== "object" || !("error" in err.body)) return null;
  const code = (err.body as { error?: unknown }).error;
  return typeof code === "string" ? code : null;
}

// Current local hour as `HH:mm` with minutes pinned to `00`, optionally offset
// by whole hours. Seeds empty time inputs so the native picker defaults to the
// top of the hour instead of the current wall-clock minute.
function currentHourTime(offsetHours = 0) {
  const d = new Date();
  d.setMinutes(0, 0, 0);
  d.setHours(d.getHours() + offsetHours);
  return `${String(d.getHours()).padStart(2, "0")}:00`;
}

function emptySlot(): Slot {
  return { proposedDate: "", startTime: currentHourTime(), endTime: currentHourTime(1) };
}

function todayIso() {
  return new Date().toISOString().split("T")[0];
}

export default function PrivateSessionsPage() {
  const router = useRouter();
  const { pt1on1, pt2on1, packages, loading: pkgLoading } = useClientPackages();
  const { data: locations } = useLocations();
  const { data: classTypes } = useClassTypes();
  const ptApi = usePtSessionsApi();

  const ptPackages = useMemo(() => packages.filter((p) => p.kind === "pt"), [packages]);

  const [sessionType, setSessionType] = useState<"1on1" | "2on1">("1on1");
  const [classTypeId, setClassTypeId] = useState<string>("");
  const [locationId, setLocationId] = useState<string>("");
  const [slots, setSlots] = useState<Slot[]>([emptySlot()]);
  const [message, setMessage] = useState<string>("");
  // Which package this request is debited from, when more than one fits. It
  // decides the instructor too, so it is the member's choice to make and not
  // ours to guess. Empty means "whichever the form picks by default".
  const [packageId, setPackageId] = useState<string>("");

  // Default to the first location once the public list loads.
  useEffect(() => {
    if (!locationId && locations && locations.length > 0) {
      setLocationId(locations[0].id);
    }
  }, [locations, locationId]);

  // Default to the first class type once the public list loads.
  useEffect(() => {
    if (!classTypeId && classTypes && classTypes.length > 0) {
      setClassTypeId(classTypes[0].id);
    }
  }, [classTypes, classTypeId]);

  // Partner state (2on1 only).
  const [partnerEmail, setPartnerEmail] = useState<string>("");
  const [partnerLookup, setPartnerLookup] = useState<
    { state: "idle" } | { state: "found"; clientId: string; name: string } | { state: "not_found" }
  >({ state: "idle" });
  const [partnerName, setPartnerName] = useState<string>("");

  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  // Set when the user submits without enough PT sessions — prompts them to buy.
  const [showBuyPrompt, setShowBuyPrompt] = useState(false);

  function setSlot(i: number, patch: Partial<Slot>) {
    setSlots((prev) => prev.map((s, j) => (i === j ? { ...s, ...patch } : s)));
  }
  function addSlot() {
    setSlots((prev) => [...prev, emptySlot()]);
  }
  function removeSlot(i: number) {
    setSlots((prev) => prev.filter((_, j) => j !== i));
  }

  async function runPartnerLookup() {
    const email = partnerEmail.trim();
    if (!email) {
      setPartnerLookup({ state: "idle" });
      return;
    }
    try {
      const r = await ptApi.partnerLookup(email);
      if (r.found && r.client_id && r.name) {
        setPartnerLookup({ state: "found", clientId: r.client_id, name: r.name });
        setPartnerName("");
      } else {
        setPartnerLookup({ state: "not_found" });
      }
    } catch {
      setPartnerLookup({ state: "not_found" });
    }
  }

  function validate(): string[] {
    const errs: string[] = [];
    if (!locationId) errs.push("Pick a location.");
    if (!classTypeId) errs.push("Pick a class type.");
    if (slots.length === 0) errs.push("Add at least one proposed slot.");
    slots.forEach((s, i) => {
      if (!s.proposedDate || !s.startTime || !s.endTime) errs.push(`Slot ${i + 1}: complete date, start and end time.`);
      else if (s.endTime <= s.startTime) errs.push(`Slot ${i + 1}: end time must be after start time.`);
    });
    if (sessionType === "2on1") {
      if (!partnerEmail.trim()) errs.push("Partner email is required for a 2-on-1.");
      else if (partnerLookup.state === "idle") errs.push("Run partner lookup first.");
      else if (partnerLookup.state === "not_found" && !partnerName.trim()) errs.push("Partner name is required when they're not yet a member.");
    }
    return errs;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    // Gate: a request needs an active PT package of the right type with enough credits.
    if (!matchingPackage || !hasEnoughCredits) {
      setShowBuyPrompt(true);
      setErrors([]);
      return;
    }
    setShowBuyPrompt(false);

    const errs = validate();
    setErrors(errs);
    if (errs.length > 0) return;

    setSubmitting(true);
    try {
      await ptApi.submitRequest({
        classTypeId,
        locationId,
        sessionType: computedSessionType,
        clientPackageId: matchingPackage.id,
        slots: slots.map((s) => ({ proposedDate: s.proposedDate, startTime: s.startTime, endTime: s.endTime })),
        message: message.trim() || undefined,
        partner: buildPartner() ?? undefined,
      });
      router.push("/account/private-sessions?submitted=1");
    } catch (err: unknown) {
      const code = apiErrorCode(err);
      const msg =
        code === ERROR_CODES.insufficient_pt_credit
          ? `This ${computedSessionType === "2on1" ? "2-on-1" : "1-on-1"} request uses ${requestCost} session${requestCost === 1 ? "" : "s"}. Choose a package with enough sessions or buy another package.`
          : code === ERROR_CODES.pt_package_not_current || code === ERROR_CODES.family_already_activated
            ? "Another private session package of yours is already running. Only one runs at a time — your next package starts once it ends or is used up."
            : err instanceof Error
            ? err.message
            : "We couldn't submit your request. Please try again.";
      if (code === ERROR_CODES.insufficient_pt_credit) setShowBuyPrompt(true);
      setErrors([msg]);
    } finally {
      setSubmitting(false);
    }
  }

  function buildPartner() {
    if (computedSessionType === "1on1") return null;
    if (partnerLookup.state === "found") {
      return { kind: "existing" as const, coClientId: partnerLookup.clientId, name: partnerLookup.name };
    }
    return { kind: "new" as const, name: partnerName.trim(), email: partnerEmail.trim() };
  }

  // If the user only has one PT format available, hide the radio.
  const has1on1 = ptPackages.some((p) => p.sessionType === "1on1");
  const has2on1 = ptPackages.some((p) => p.sessionType === "2on1");
  const showSessionTypeChoice = (has1on1 && has2on1) || ptPackages.length === 0;
  const computedSessionType: "1on1" | "2on1" = useMemo(() => {
    if (showSessionTypeChoice) return sessionType;
    if (has2on1 && !has1on1) return "2on1";
    return "1on1";
  }, [showSessionTypeChoice, sessionType, has1on1, has2on1]);

  const balanceForType = (t: "1on1" | "2on1") => (t === "2on1" ? pt2on1 : pt1on1);
  const requestCost = computedSessionType === "2on1" ? 2 : 1;
  // One PT package runs at a time (§3). While one is running it is the only
  // package a request can be debited from; every other one waits Dormant
  // behind it, whatever its session type. With nothing running, the member's
  // pick is the package that starts. Backend-derived `dormant`, never re-tested.
  const runningPt = useMemo(() => ptPackages.find((p) => !p.dormant) ?? null, [ptPackages]);
  const waitingPtCount = ptPackages.length - (runningPt ? 1 : 0);
  // Every package that could pay for this request. More than one means the
  // member picks, because the package they pick decides the instructor.
  const eligiblePackages = useMemo(
    () =>
      (runningPt ? [runningPt] : ptPackages).filter(
        (p) =>
          p.sessionType === computedSessionType &&
          (p.creditsOrSessionsRemaining ?? 0) >= requestCost,
      ),
    [ptPackages, runningPt, computedSessionType, requestCost],
  );
  // A pick that no longer fits (the session type changed under it) falls back
  // rather than lingering — the request must never be debited from a package
  // the member can no longer see in the list.
  const matchingPackage =
    eligiblePackages.find((p) => p.id === packageId) ?? eligiblePackages[0];
  const hasPackageForType = ptPackages.some((p) => p.sessionType === computedSessionType);
  const hasEnoughCredits = Boolean(matchingPackage) && balanceForType(computedSessionType) >= requestCost;
  // The running package cannot pay for this request (wrong type, or too few
  // sessions) and a Dormant one is waiting that could — but it may not start
  // until the running one ends. Named so the prompt says that, not "buy one".
  const blockedByRunning =
    !!runningPt &&
    !matchingPackage &&
    ptPackages.some(
      (p) =>
        p.id !== runningPt.id &&
        p.sessionType === computedSessionType &&
        (p.creditsOrSessionsRemaining ?? 0) >= requestCost,
    );

  return (
    <BookingSurface maxWidth="md" flush>
      <ScheduleSegments />
      <SectionHeading
        eyebrow="Private sessions"
        title="Request a session"
        description="Tell us what you want and when — we'll reach you on WhatsApp shortly to confirm."
      />

      {pkgLoading ? (
        <div className="space-y-4" aria-busy="true" aria-label="Loading your packages">
          <Skeleton className="h-12 rounded-xl" />
          <Skeleton className="h-12 rounded-xl" />
          <Skeleton className="h-28 rounded-xl" />
        </div>
      ) : (
        <form className="space-y-6" onSubmit={handleSubmit}>
          {!showSessionTypeChoice && (
            <p className="text-xs text-muted">
              You have {balanceForType(computedSessionType)}{" "}
              {computedSessionType === "2on1" ? "2-on-1" : "1-on-1"} session
              {balanceForType(computedSessionType) === 1 ? "" : "s"} remaining.
              {" "}This request uses {requestCost}.
            </p>
          )}

          {showSessionTypeChoice && (
            <div>
              <p className="text-sm font-medium text-ink mb-1.5">Session type</p>
              <div className="grid grid-cols-2 gap-2" role="group" aria-label="Session type">
                {(["1on1", "2on1"] as const).map((t) => (
                  <button
                    type="button"
                    key={t}
                    aria-pressed={computedSessionType === t}
                    onClick={() => setSessionType(t)}
                    className={`min-h-[48px] rounded-xl border px-4 py-3 text-sm font-medium transition ${
                      computedSessionType === t
                        ? "border-accent bg-accent/10 text-ink ring-1 ring-accent"
                        : "border-ink/10 bg-card text-muted hover:border-accent/40"
                    }`}
                  >
                    {t === "1on1" ? "1-on-1" : "2-on-1"}
                  </button>
                ))}
              </div>
              <p className="text-xs text-muted mt-2">
                You have {pt1on1} 1-on-1 and {pt2on1} 2-on-1 sessions remaining.
              </p>
            </div>
          )}

          {eligiblePackages.length > 1 && (
            <div>
              <label
                className="text-sm font-medium text-ink mb-1.5 block"
                htmlFor="pt-package"
              >
                Use package
              </label>
              <select
                id="pt-package"
                value={matchingPackage?.id ?? ""}
                onChange={(e) => setPackageId(e.target.value)}
                className="w-full min-h-[44px] rounded-xl border border-ink/10 bg-card px-3 py-2.5 text-sm text-ink focus:outline-none focus:border-accent"
              >
                {eligiblePackages.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} — {p.creditsOrSessionsRemaining ?? 0} left
                    {p.boundInstructor ? ` · with ${p.boundInstructor.name}` : ""}
                  </option>
                ))}
              </select>
            </div>
          )}

          {matchingPackage?.boundInstructor && (
            <p className="rounded-xl border border-accent/25 bg-accent/5 px-3 py-2.5 text-sm text-ink">
              Your sessions will be with {matchingPackage.boundInstructor.name}.
            </p>
          )}

          {/* A running package and others waiting: say so, so a member who
              bought a second package is not left wondering why it is not
              offered. Only one runs at a time; the next starts when it ends. */}
          {runningPt && waitingPtCount > 0 && (
            <p className="text-xs text-muted">
              Requests come off your {runningPt.name} while it runs. Your{" "}
              {waitingPtCount === 1 ? "other package starts" : `${waitingPtCount} other packages start`}{" "}
              once it ends or is used up.
            </p>
          )}

          <div>
            <label className="text-sm font-medium text-ink mb-1.5 block" htmlFor="location">
              Location
            </label>
            <select
              id="location"
              value={locationId}
              onChange={(e) => setLocationId(e.target.value)}
              className="w-full min-h-[44px] rounded-xl border border-ink/10 bg-card px-3 py-2.5 text-sm text-ink focus:outline-none focus:border-accent"
            >
              {(locations ?? []).map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-sm font-medium text-ink mb-1.5 block" htmlFor="class-type">
              Class type
            </label>
            <select
              id="class-type"
              value={classTypeId}
              onChange={(e) => setClassTypeId(e.target.value)}
              className="w-full min-h-[44px] rounded-xl border border-ink/10 bg-card px-3 py-2.5 text-sm text-ink focus:outline-none focus:border-accent"
            >
              {(classTypes ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-medium text-ink">
                Proposed slots
                <span className="ml-1.5 font-normal text-muted">— more options, faster confirmation</span>
              </p>
            </div>
            <div className="space-y-3">
              {slots.map((s, i) => (
                <div
                  key={i}
                  className="rounded-xl border border-ink/10 bg-card p-3"
                >
                  {/* Date across the full width and the two times side by side
                      on a phone; one row from sm. */}
                  <div className="grid grid-cols-2 sm:grid-cols-[1fr_1fr_1fr_auto] gap-2 items-end">
                    <div className="col-span-2 sm:col-span-1">
                      <label
                        htmlFor={`slot-${i}-date`}
                        className="text-xs text-muted mb-1 block"
                      >
                        Date
                      </label>
                      <input
                        id={`slot-${i}-date`}
                        type="date"
                        min={todayIso()}
                        value={s.proposedDate}
                        onChange={(e) => setSlot(i, { proposedDate: e.target.value })}
                        className="w-full min-h-[44px] rounded-lg border border-ink/10 bg-paper px-3 py-2 text-sm text-ink focus:outline-none focus:border-accent"
                      />
                    </div>
                    <div>
                      <label
                        htmlFor={`slot-${i}-start`}
                        className="text-xs text-muted mb-1 block"
                      >
                        Start time
                      </label>
                      <input
                        id={`slot-${i}-start`}
                        type="time"
                        value={s.startTime}
                        onChange={(e) => setSlot(i, { startTime: e.target.value })}
                        className="w-full min-h-[44px] rounded-lg border border-ink/10 bg-paper px-3 py-2 text-sm text-ink focus:outline-none focus:border-accent"
                      />
                    </div>
                    <div>
                      <label
                        htmlFor={`slot-${i}-end`}
                        className="text-xs text-muted mb-1 block"
                      >
                        End time
                      </label>
                      <input
                        id={`slot-${i}-end`}
                        type="time"
                        value={s.endTime}
                        onChange={(e) => setSlot(i, { endTime: e.target.value })}
                        className="w-full min-h-[44px] rounded-lg border border-ink/10 bg-paper px-3 py-2 text-sm text-ink focus:outline-none focus:border-accent"
                      />
                    </div>
                    {/* A lone slot has nothing to remove, so no button. */}
                    {slots.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeSlot(i)}
                        className="col-span-2 sm:col-span-1 inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-lg border border-ink/10 px-3 text-sm text-muted hover:text-error hover:border-error/40 transition-colors"
                        aria-label={`Remove slot ${i + 1}`}
                      >
                        <Trash2 size={14} />
                        <span className="sm:hidden">Remove slot</span>
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={addSlot}
              className="mt-3 inline-flex min-h-[44px] w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-ink/20 text-sm font-medium text-accent-deep hover:border-accent hover:bg-accent/5 transition-colors"
            >
              <Plus size={16} /> Add another slot
            </button>
          </div>

          {computedSessionType === "2on1" && (
            <div>
              <label className="text-sm font-medium text-ink mb-1.5 block" htmlFor="partner-email">
                Partner email
              </label>
              <div className="flex gap-2">
                <input
                  id="partner-email"
                  type="email"
                  value={partnerEmail}
                  onChange={(e) => {
                    setPartnerEmail(e.target.value);
                    setPartnerLookup({ state: "idle" });
                  }}
                  onBlur={runPartnerLookup}
                  placeholder="partner@example.com"
                  className="min-w-0 flex-1 min-h-[44px] rounded-xl border border-ink/10 bg-card px-3 py-2.5 text-sm text-ink focus:outline-none focus:border-accent"
                />
                <button
                  type="button"
                  onClick={runPartnerLookup}
                  className="shrink-0 min-h-[44px] rounded-xl border border-ink/10 bg-card px-3 py-2.5 text-sm font-medium text-ink hover:bg-warm"
                >
                  Look up
                </button>
              </div>
              {partnerLookup.state === "found" && (
                <p className="mt-2 inline-flex items-center gap-1.5 text-xs text-sage">
                  <CheckCircle2 size={14} /> {partnerLookup.name} — existing member.
                </p>
              )}
              {partnerLookup.state === "not_found" && (
                <div className="mt-2 space-y-2">
                  <p className="inline-flex items-center gap-1.5 text-xs text-muted">
                    <AlertCircle size={14} /> Not a member yet — the studio will create their account.
                  </p>
                  <input
                    type="text"
                    value={partnerName}
                    onChange={(e) => setPartnerName(e.target.value)}
                    placeholder="Partner full name"
                    className="w-full min-h-[44px] rounded-xl border border-ink/10 bg-card px-3 py-2.5 text-sm text-ink focus:outline-none focus:border-accent"
                  />
                </div>
              )}
            </div>
          )}

          <div>
            <label className="text-sm font-medium text-ink mb-1.5 block" htmlFor="message">
              Note (optional)
            </label>
            <textarea
              id="message"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={3}
              placeholder="Anything we should know — focus areas, injuries, preferences."
              className="w-full min-h-[44px] rounded-xl border border-ink/10 bg-card px-3 py-2.5 text-sm text-ink focus:outline-none focus:border-accent resize-y"
            />
          </div>

          {showBuyPrompt && blockedByRunning && runningPt && (
            <div className="rounded-2xl border border-warning/30 bg-warning/10 p-5 text-sm text-ink">
              Your {runningPt.name} is running, and only one private session package
              can run at a time. Your next package starts once it ends
              {runningPt.expiresAt ? ` (${formatDate(runningPt.expiresAt)})` : ""} or is
              used up.
            </div>
          )}

          {showBuyPrompt && !blockedByRunning && (
            <div className="rounded-2xl border border-warning/30 bg-warning/10 p-5 text-sm text-ink">
              {!hasPackageForType
                ? `You don't have an active ${computedSessionType === "2on1" ? "2-on-1" : "1-on-1"} PT package yet.`
                : `You need ${requestCost} ${computedSessionType === "2on1" ? "2-on-1" : "1-on-1"} session${requestCost === 1 ? "" : "s"} in one active package to submit this request.`}{" "}
              <Link href="/packages#private" className="underline font-medium hover:text-ink">
                Buy a private session package
              </Link>{" "}
              to continue.
            </div>
          )}

          {errors.length > 0 && (
            <ul className="rounded-xl border border-error/30 bg-error/10 p-3 text-xs text-error space-y-1">
              {errors.map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full min-h-[48px] rounded-full bg-ink text-paper px-6 py-3 text-sm font-medium hover:bg-ink/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting
              ? "Submitting…"
              : `Submit request (uses ${requestCost} session${requestCost === 1 ? "" : "s"})`}
          </button>
        </form>
      )}
    </BookingSurface>
  );
}
