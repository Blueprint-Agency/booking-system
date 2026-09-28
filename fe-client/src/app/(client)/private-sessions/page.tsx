"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Plus, Trash2, CheckCircle2, AlertCircle, CalendarRange } from "lucide-react";
import { BookingSurface } from "@/components/booking/booking-surface";
import { PageHeader } from "@/components/booking/page-header";
import { ScheduleSegments } from "@/components/booking/schedule-segments";
import { Select } from "@/components/ui/select";
import { ContentLoading } from "@/components/ui/content-loading";
import { BTN_PRIMARY, CARD } from "@/components/ui/styles";
import { useClientPackages } from "@/lib/use-client-packages";
import { useLocations, useClassTypes } from "@/lib/classes";
import { PreferredClassType } from "@/components/booking/preferred-class-type";
import { usePtSessionsApi, HALF_HOUR_TIMES, formatSlotTime } from "@/lib/pt-sessions";
import { ApiError } from "@/lib/api";
import {
  ptSlotDateProblem,
  ptWindowDates,
  ptWindowNotice,
  ptWindowRefusal,
  sgDatePlus,
} from "@/lib/pt-booking-window";
import { usePtBookingWindow } from "@/lib/use-pt-booking-window";
import { ERROR_CODES } from "@/lib/error-codes";
import { cn } from "@/lib/utils";
import { initialPtPick, ptPickRows, sessionTypeLabel, sessionsWord } from "@/lib/pt-package-picker";
import { ConfirmPtRequestSheet, slotLabel } from "@/components/private-sessions/confirm-pt-request-sheet";
import { RequestSentCelebration } from "@/components/celebration/request-sent-celebration";

type Slot = { proposedDate: string; startTime: string };

function apiErrorCode(err: unknown): string | null {
  if (!(err instanceof ApiError)) return null;
  if (!err.body || typeof err.body !== "object" || !("error" in err.body)) return null;
  const code = (err.body as { error?: unknown }).error;
  return typeof code === "string" ? code : null;
}

// The next hour as `HH:00`, so a new slot starts on a time the picker offers.
// In studio time, as the slot's date is (`sgDatePlus`): the runtime's own zone
// is UTC on the server and the member's wherever they are.
function nextHourTime() {
  const hour = Number(
    new Date().toLocaleString("en-GB", { hour: "2-digit", hourCycle: "h23", timeZone: "Asia/Singapore" }),
  );
  return `${String((hour + 1) % 24).padStart(2, "0")}:00`;
}

function emptySlot(): Slot {
  return { proposedDate: "", startTime: nextHourTime() };
}

export default function PrivateSessionsPage() {
  const router = useRouter();
  const { pt1on1, pt2on1, packages, loading: pkgLoading } = useClientPackages();
  const { data: locations } = useLocations();
  const { data: classTypes } = useClassTypes();
  const ptApi = usePtSessionsApi();
  // The studio's Book in advance window, on its Singapore calendar whatever the
  // device's zone. Until it has loaded the picker only rules out today and
  // earlier, which no window allows; the server stays the enforcement.
  const bookingWindow = usePtBookingWindow();
  const dateBounds = bookingWindow ? ptWindowDates(bookingWindow) : { earliest: sgDatePlus(1), latest: undefined };

  const ptPackages = useMemo(() => packages.filter((p) => p.kind === "pt"), [packages]);

  const [sessionType, setSessionType] = useState<"1on1" | "2on1">("1on1");
  // Null is "Any" — the default; the member may narrow it to one class type.
  const [classTypeId, setClassTypeId] = useState<string | null>(null);
  const [locationId, setLocationId] = useState<string>("");
  const [slots, setSlots] = useState<Slot[]>(() => [emptySlot()]);
  const [message, setMessage] = useState<string>("");
  // The confirm sheet, where the member picks which package pays: it decides
  // the instructor too, so it is theirs to choose and not ours to guess.
  const [confirming, setConfirming] = useState(false);
  const [packageId, setPackageId] = useState<string | null>(null);
  const [sheetError, setSheetError] = useState<string | null>(null);
  // Set once the request is in: the "Request sent!" celebration.
  const [sent, setSent] = useState(false);

  // Default to the first location once the public list loads.
  useEffect(() => {
    if (!locationId && locations && locations.length > 0) {
      setLocationId(locations[0].id);
    }
  }, [locations, locationId]);

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
    if (slots.length === 0) errs.push("Add at least one proposed slot.");
    slots.forEach((s, i) => {
      if (!s.proposedDate || !s.startTime) {
        errs.push(`Time ${i + 1}: pick a date and start time.`);
        return;
      }
      const problem = bookingWindow
        ? ptSlotDateProblem(s.proposedDate, i + 1, bookingWindow)
        : s.proposedDate < dateBounds.earliest
          ? `Time ${i + 1}: pick a date from tomorrow on.`
          : null;
      if (problem) errs.push(problem);
    });
    if (sessionType === "2on1") {
      if (!partnerEmail.trim()) errs.push("Partner email is required for a 2-on-1.");
      else if (partnerLookup.state === "idle") errs.push("Run partner lookup first.");
      else if (partnerLookup.state === "not_found" && !partnerName.trim()) errs.push("Partner name is required when they're not yet a member.");
    }
    return errs;
  }

  /** The form's own checks, then the confirm sheet — nothing is sent from here. */
  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    // A member with no PT package of this type has nothing to pick from.
    if (!hasPackageForType) {
      setShowBuyPrompt(true);
      setErrors([]);
      return;
    }
    setShowBuyPrompt(false);

    const errs = validate();
    setErrors(errs);
    if (errs.length > 0) return;

    setPackageId(initialPtPick(pickRows));
    setSheetError(null);
    setConfirming(true);
  }

  /** What to tell the member when the server refuses the request. */
  function submitFailure(err: unknown): string {
    const code = apiErrorCode(err);
    if (code === ERROR_CODES.insufficient_pt_credit) {
      return `That package no longer has ${sessionsWord(requestCost)} left. Pick another, or buy a package.`;
    }
    if (code === ERROR_CODES.slot_date_too_soon || code === ERROR_CODES.slot_date_too_far) {
      return (
        (bookingWindow && ptWindowRefusal(code, bookingWindow)) ??
        "One of your times is outside the days the studio takes bookings for. Please pick another date."
      );
    }
    return err instanceof Error ? err.message : "We couldn't submit your request. Please try again.";
  }

  /** Send, paid by the package picked on the sheet. */
  async function send(clientPackageId: string) {
    setSubmitting(true);
    setSheetError(null);
    try {
      await ptApi.submitRequest({
        classTypeId,
        locationId,
        sessionType: computedSessionType,
        clientPackageId,
        slots: slots.map((s) => ({ proposedDate: s.proposedDate, startTime: s.startTime })),
        message: message.trim() || undefined,
        partner: buildPartner() ?? undefined,
      });
      setConfirming(false);
      setSent(true);
    } catch (err: unknown) {
      setSheetError(submitFailure(err));
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
  // Every PT package of this session type, each able to pay or greyed with the
  // reason — the confirm sheet's list. Any number of PT packages may run at
  // once (be/docs/adr/0010), so a Dormant pick simply starts.
  const pickRows = useMemo(
    () => ptPickRows(ptPackages, computedSessionType, requestCost),
    [ptPackages, computedSessionType, requestCost],
  );
  const hasPackageForType = pickRows.length > 0;
  const locationName = locations?.find((l) => l.id === locationId)?.name ?? null;
  const classTypeName = classTypeId ? (classTypes?.find((t) => t.id === classTypeId)?.name ?? null) : null;
  const partnerDisplay =
    computedSessionType === "2on1"
      ? partnerLookup.state === "found"
        ? partnerLookup.name
        : partnerName.trim() || null
      : null;

  return (
    <BookingSurface>
      <PageHeader title="Schedule" />
      <ScheduleSegments />

      {pkgLoading ? (
        <ContentLoading label="Loading your packages" />
      ) : (
        // noValidate: the browser's own bubble ("Value must be …") would speak
        // for the date picker's bounds; validate() says it in the member's words.
        <form noValidate className={cn(CARD, "max-w-2xl p-4 sm:p-6 space-y-6")} onSubmit={handleSubmit}>
          <div>
            <h2 className="text-base font-bold text-ink">Request a private session</h2>
            <p className="mt-0.5 text-sm text-muted">
              Suggest a few times. We confirm on WhatsApp.
            </p>
          </div>
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

          <div>
            <label className="text-sm font-medium text-ink mb-1.5 block" htmlFor="location">
              Location
            </label>
            <Select
              id="location"
              value={locationId}
              onChange={setLocationId}
              options={(locations ?? []).map((l) => ({ value: l.id, label: l.name }))}
            />
          </div>

          <PreferredClassType
            classTypes={classTypes ?? []}
            value={classTypeId}
            onChange={setClassTypeId}
          />

          <div>
            <p className="text-sm font-medium text-ink mb-2">
              Times that suit you
              <span className="ml-1.5 font-normal text-muted">More options confirm faster</span>
            </p>
            {bookingWindow && (
              <p className="mb-3 inline-flex items-start gap-1.5 rounded-xl border border-cyan/40 bg-cyan/10 px-3 py-1.5 text-xs font-medium text-cyan-deep">
                <CalendarRange className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
                {ptWindowNotice(bookingWindow)}
              </p>
            )}
            <div className="space-y-3">
              {slots.map((s, i) => (
                <div
                  key={i}
                  className="rounded-xl bg-ink/[0.03] p-3"
                >
                  {/* Date and start time side by side; the remove button under
                      them on a phone, beside them from sm. */}
                  <div className="grid grid-cols-2 sm:grid-cols-[1fr_1fr_auto] gap-2 items-end">
                    <div>
                      <label
                        htmlFor={`slot-${i}-date`}
                        className="text-xs text-muted mb-1 block"
                      >
                        Date
                      </label>
                      <input
                        id={`slot-${i}-date`}
                        type="date"
                        min={dateBounds.earliest}
                        max={dateBounds.latest}
                        value={s.proposedDate}
                        onChange={(e) => setSlot(i, { proposedDate: e.target.value })}
                        className="w-full min-h-[44px] rounded-lg border border-ink/10 bg-card px-3 py-2 text-sm text-ink focus:outline-none focus:border-accent"
                      />
                    </div>
                    <div>
                      <label
                        htmlFor={`slot-${i}-start`}
                        className="text-xs text-muted mb-1 block"
                      >
                        Start time
                      </label>
                      {/* On the hour or half hour only — a native time input
                          would offer every minute. */}
                      <Select
                        id={`slot-${i}-start`}
                        value={s.startTime}
                        onChange={(v) => setSlot(i, { startTime: v })}
                        options={HALF_HOUR_TIMES.map((t) => ({ value: t, label: formatSlotTime(t) }))}
                        triggerClassName="rounded-lg px-3"
                      />
                    </div>
                    {/* A lone slot has nothing to remove, so no button. */}
                    {slots.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeSlot(i)}
                        className="col-span-2 sm:col-span-1 inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-lg border border-ink/10 px-3 text-sm text-muted hover:text-error hover:border-error/40 transition-colors"
                        aria-label={`Remove time ${i + 1}`}
                      >
                        <Trash2 size={14} />
                        <span className="sm:hidden">Remove</span>
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
              <Plus size={16} /> Add another time
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

          {showBuyPrompt && (
            <div className="rounded-xl border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-ink">
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
            className={cn(BTN_PRIMARY, "w-full")}
          >
            {`Send request · ${sessionsWord(requestCost)}`}
          </button>
        </form>
      )}

      {confirming && (
        <ConfirmPtRequestSheet
          summary={{
            sessionType: computedSessionType,
            locationName,
            classTypeName,
            slots,
            partnerName: partnerDisplay,
          }}
          rows={pickRows}
          picked={packageId}
          onPick={setPackageId}
          cost={requestCost}
          sending={submitting}
          error={sheetError}
          onConfirm={(id) => void send(id)}
          onClose={() => setConfirming(false)}
        />
      )}

      {sent && (
        <RequestSentCelebration
          kind="pt"
          name={`${classTypeName ?? "Private session"} · ${sessionTypeLabel(computedSessionType)}`}
          detail={slots.length === 1 ? slotLabel(slots[0]!) : `${slots.length} times suggested`}
          place={locationName}
          person={partnerDisplay ? `With ${partnerDisplay}` : null}
          onClose={() => router.push("/account/bookings?type=pt")}
        />
      )}
    </BookingSurface>
  );
}
