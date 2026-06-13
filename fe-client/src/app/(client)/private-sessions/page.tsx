"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Plus, Trash2, CheckCircle2, AlertCircle } from "lucide-react";
import { BookingSurface } from "@/components/booking/booking-surface";
import { SectionHeading } from "@/components/booking/section-heading";
import { ScheduleSegments } from "@/components/booking/schedule-segments";
import { useClientPackages } from "@/lib/use-client-packages";
import { useLocations, useClassTypes } from "@/lib/classes";
import { usePtSessionsApi } from "@/lib/pt-sessions";

type Slot = { proposedDate: string; startTime: string; endTime: string };

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

  const ptPackages = packages.filter((p) => p.kind === "pt");

  const [sessionType, setSessionType] = useState<"1on1" | "2on1">("1on1");
  const [classTypeId, setClassTypeId] = useState<string>("");
  const [locationId, setLocationId] = useState<string>("");
  const [slots, setSlots] = useState<Slot[]>([emptySlot()]);
  const [message, setMessage] = useState<string>("");

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
      const msg =
        err instanceof Error ? err.message : "We couldn't submit your request. Please try again.";
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
  const matchingPackage = ptPackages.find((p) => p.sessionType === computedSessionType);
  const hasEnoughCredits = balanceForType(computedSessionType) >= 1;

  return (
    <BookingSurface maxWidth="md" padding="default">
      <SectionHeading eyebrow="Private sessions" title="Request a session" />
      <div className="mt-4">
        <ScheduleSegments />
      </div>
      <p className="text-sm text-muted mt-2 mb-8 leading-relaxed">
        Tell us what you want and when — we&apos;ll reach you on WhatsApp shortly to confirm. No back-and-forth in the app.
      </p>

      {pkgLoading ? (
        <div className="text-sm text-muted py-12 text-center">Loading your packages…</div>
      ) : (
        <form className="space-y-6" onSubmit={handleSubmit}>
          {!showSessionTypeChoice && (
            <p className="text-xs text-muted">
              You have {balanceForType(computedSessionType)}{" "}
              {computedSessionType === "2on1" ? "2-on-1" : "1-on-1"} session
              {balanceForType(computedSessionType) === 1 ? "" : "s"} remaining.
            </p>
          )}

          {showSessionTypeChoice && (
            <div>
              <label className="text-xs uppercase tracking-wider text-muted mb-2 block">Session type</label>
              <div className="grid grid-cols-2 gap-2">
                {(["1on1", "2on1"] as const).map((t) => (
                  <button
                    type="button"
                    key={t}
                    onClick={() => setSessionType(t)}
                    className={`rounded-xl border px-4 py-3 text-sm transition ${
                      computedSessionType === t
                        ? "border-accent bg-accent/10 text-ink"
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
            <label className="text-xs uppercase tracking-wider text-muted mb-1.5 block" htmlFor="location">
              Location
            </label>
            <select
              id="location"
              value={locationId}
              onChange={(e) => setLocationId(e.target.value)}
              className="w-full rounded-xl border border-ink/10 bg-card px-3 py-2.5 text-sm text-ink focus:outline-none focus:border-accent"
            >
              {(locations ?? []).map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-xs uppercase tracking-wider text-muted mb-1.5 block" htmlFor="class-type">
              Class type
            </label>
            <select
              id="class-type"
              value={classTypeId}
              onChange={(e) => setClassTypeId(e.target.value)}
              className="w-full rounded-xl border border-ink/10 bg-card px-3 py-2.5 text-sm text-ink focus:outline-none focus:border-accent"
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
              <label className="text-xs uppercase tracking-wider text-muted">Proposed slots</label>
              <button
                type="button"
                onClick={addSlot}
                className="inline-flex items-center gap-1 text-xs text-accent hover:text-accent-deep"
              >
                <Plus size={14} /> Add slot
              </button>
            </div>
            <div className="space-y-3">
              {slots.map((s, i) => (
                <div
                  key={i}
                  className="rounded-xl border border-ink/10 bg-card p-3"
                >
                  <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_1fr_auto] gap-2 items-end">
                    <div>
                      <label
                        htmlFor={`slot-${i}-date`}
                        className="text-[11px] uppercase tracking-wider text-muted mb-1 block"
                      >
                        Date
                      </label>
                      <input
                        id={`slot-${i}-date`}
                        type="date"
                        min={todayIso()}
                        value={s.proposedDate}
                        onChange={(e) => setSlot(i, { proposedDate: e.target.value })}
                        className="w-full rounded-lg border border-ink/10 bg-paper px-3 py-2 text-sm text-ink focus:outline-none focus:border-accent"
                      />
                    </div>
                    <div>
                      <label
                        htmlFor={`slot-${i}-start`}
                        className="text-[11px] uppercase tracking-wider text-muted mb-1 block"
                      >
                        Start time
                      </label>
                      <input
                        id={`slot-${i}-start`}
                        type="time"
                        value={s.startTime}
                        onChange={(e) => setSlot(i, { startTime: e.target.value })}
                        className="w-full rounded-lg border border-ink/10 bg-paper px-3 py-2 text-sm text-ink focus:outline-none focus:border-accent"
                      />
                    </div>
                    <div>
                      <label
                        htmlFor={`slot-${i}-end`}
                        className="text-[11px] uppercase tracking-wider text-muted mb-1 block"
                      >
                        End time
                      </label>
                      <input
                        id={`slot-${i}-end`}
                        type="time"
                        value={s.endTime}
                        onChange={(e) => setSlot(i, { endTime: e.target.value })}
                        className="w-full rounded-lg border border-ink/10 bg-paper px-3 py-2 text-sm text-ink focus:outline-none focus:border-accent"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => removeSlot(i)}
                      disabled={slots.length === 1}
                      className="inline-flex items-center justify-center rounded-lg border border-ink/10 px-3 py-2 text-muted hover:text-error disabled:opacity-40 disabled:cursor-not-allowed"
                      aria-label={`Remove slot ${i + 1}`}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {computedSessionType === "2on1" && (
            <div>
              <label className="text-xs uppercase tracking-wider text-muted mb-1.5 block" htmlFor="partner-email">
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
                  className="flex-1 rounded-xl border border-ink/10 bg-card px-3 py-2.5 text-sm text-ink focus:outline-none focus:border-accent"
                />
                <button
                  type="button"
                  onClick={runPartnerLookup}
                  className="rounded-xl border border-ink/10 px-3 py-2.5 text-sm text-ink hover:bg-warm"
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
                    className="w-full rounded-xl border border-ink/10 bg-card px-3 py-2.5 text-sm text-ink focus:outline-none focus:border-accent"
                  />
                </div>
              )}
            </div>
          )}

          <div>
            <label className="text-xs uppercase tracking-wider text-muted mb-1.5 block" htmlFor="message">
              Note (optional)
            </label>
            <textarea
              id="message"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={3}
              placeholder="Anything we should know — focus areas, injuries, preferences."
              className="w-full rounded-xl border border-ink/10 bg-card px-3 py-2.5 text-sm text-ink focus:outline-none focus:border-accent resize-y"
            />
          </div>

          {showBuyPrompt && (
            <div className="rounded-2xl border border-warning/30 bg-warning/10 p-5 text-sm text-ink">
              {!matchingPackage
                ? `You don't have an active ${computedSessionType === "2on1" ? "2-on-1" : "1-on-1"} PT package yet.`
                : `You have no ${computedSessionType === "2on1" ? "2-on-1" : "1-on-1"} credits remaining.`}{" "}
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
            className="w-full rounded-full bg-ink text-paper px-6 py-3 text-sm font-medium hover:bg-ink/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting ? "Submitting…" : `Submit request (uses 1 session)`}
          </button>
        </form>
      )}
    </BookingSurface>
  );
}
