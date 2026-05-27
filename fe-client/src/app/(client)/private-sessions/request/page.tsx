"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Plus, Trash2, ChevronLeft, CheckCircle2, AlertCircle } from "lucide-react";
import { BookingSurface } from "@/components/booking/booking-surface";
import { SectionHeading } from "@/components/booking/section-heading";
import { useClientPackages } from "@/lib/use-client-packages";
import {
  mockPartnerLookup,
  submitPtRequest,
  type LocalPtRequestPartner,
} from "@/lib/pt-requests-mock";

// Class types: hardcoded list until /public/class-types ships. Matches the
// admin-side seed names so the dropdown UX is realistic during preview.
const CLASS_TYPES: { id: string; name: string }[] = [
  { id: "ct-vinyasa", name: "Vinyasa Flow" },
  { id: "ct-yin", name: "Yin Yoga" },
  { id: "ct-aerial", name: "Aerial Yoga" },
  { id: "ct-restorative", name: "Restorative" },
  { id: "ct-prenatal", name: "Prenatal" },
];

type Slot = { proposedDate: string; startTime: string; endTime: string };

function emptySlot(): Slot {
  return { proposedDate: "", startTime: "", endTime: "" };
}

function todayIso() {
  return new Date().toISOString().split("T")[0];
}

export default function RequestPtPage() {
  const router = useRouter();
  const { ptSessions, packages, loading: pkgLoading } = useClientPackages();

  const ptPackages = packages.filter((p) => p.kind === "pt");
  // First active PT package — the form debits this one. Real BE will pick
  // by session_type compatibility.
  const defaultPackageId = ptPackages[0]?.id ?? "";

  const [sessionType, setSessionType] = useState<"1on1" | "2on1">("1on1");
  const [classTypeId, setClassTypeId] = useState<string>(CLASS_TYPES[0].id);
  const [slots, setSlots] = useState<Slot[]>([emptySlot()]);
  const [message, setMessage] = useState<string>("");

  // Partner state (2on1 only).
  const [partnerEmail, setPartnerEmail] = useState<string>("");
  const [partnerLookup, setPartnerLookup] = useState<
    { state: "idle" } | { state: "found"; clientId: string; name: string } | { state: "not_found" }
  >({ state: "idle" });
  const [partnerName, setPartnerName] = useState<string>("");

  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);

  const required = sessionType === "2on1" ? 2 : 1;
  const hasEnoughCredits = ptSessions >= required;

  function setSlot(i: number, patch: Partial<Slot>) {
    setSlots((prev) => prev.map((s, j) => (i === j ? { ...s, ...patch } : s)));
  }
  function addSlot() {
    setSlots((prev) => [...prev, emptySlot()]);
  }
  function removeSlot(i: number) {
    setSlots((prev) => prev.filter((_, j) => j !== i));
  }

  function runPartnerLookup() {
    const email = partnerEmail.trim();
    if (!email) {
      setPartnerLookup({ state: "idle" });
      return;
    }
    const r = mockPartnerLookup(email);
    if (r.found && r.clientId && r.name) {
      setPartnerLookup({ state: "found", clientId: r.clientId, name: r.name });
      setPartnerName("");
    } else {
      setPartnerLookup({ state: "not_found" });
    }
  }

  function validate(): string[] {
    const errs: string[] = [];
    if (!defaultPackageId) errs.push("You need a PT package before submitting a request.");
    if (!hasEnoughCredits) errs.push(`This ${sessionType === "2on1" ? "2-on-1" : "1-on-1"} request needs ${required} session${required === 1 ? "" : "s"}, you have ${ptSessions}.`);
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
    const errs = validate();
    setErrors(errs);
    if (errs.length > 0) return;

    setSubmitting(true);
    const partner = buildPartner();
    const classType = CLASS_TYPES.find((c) => c.id === classTypeId)!;
    submitPtRequest({
      classTypeId,
      className: classType.name,
      sessionType,
      slots,
      message: message.trim(),
      partner,
    });
    // BE submit is still 501 — local store is the source of truth for now.
    // When wired: POST /me/pt-sessions/request → on success, refetchClientPackages() then redirect.
    router.push("/account/private-sessions?submitted=1");
  }

  function buildPartner(): LocalPtRequestPartner | null {
    if (sessionType === "1on1") return null;
    if (partnerLookup.state === "found") {
      return { kind: "existing", coClientId: partnerLookup.clientId, name: partnerLookup.name };
    }
    return { kind: "new", name: partnerName.trim(), email: partnerEmail.trim() };
  }

  // If the user only has one PT format available, hide the radio.
  const has1on1 = ptPackages.some((p) => /1on1|1-on-1/i.test(p.name));
  const has2on1 = ptPackages.some((p) => /2on1|2-on-1/i.test(p.name));
  const showSessionTypeChoice = (has1on1 && has2on1) || ptPackages.length === 0;
  const computedSessionType: "1on1" | "2on1" = useMemo(() => {
    if (showSessionTypeChoice) return sessionType;
    if (has2on1 && !has1on1) return "2on1";
    return "1on1";
  }, [showSessionTypeChoice, sessionType, has1on1, has2on1]);

  return (
    <BookingSurface maxWidth="md" padding="default">
      <Link
        href="/private-sessions"
        className="inline-flex items-center gap-1 text-xs text-muted hover:text-ink mb-4"
      >
        <ChevronLeft size={14} /> Back to private sessions
      </Link>
      <SectionHeading eyebrow="Private sessions" title="Request a session" />
      <p className="text-sm text-muted mt-2 mb-8 leading-relaxed">
        Tell us what you want and when — we&apos;ll reach you on WhatsApp shortly to confirm. No back-and-forth in the app.
      </p>

      {pkgLoading ? (
        <div className="text-sm text-muted py-12 text-center">Loading your packages…</div>
      ) : ptPackages.length === 0 ? (
        <div className="rounded-2xl border border-warning/30 bg-warning/10 p-5 text-sm text-ink">
          You don&apos;t have an active PT package yet.{" "}
          <Link href="/packages#private" className="underline hover:text-ink">
            Buy a private session package
          </Link>{" "}
          to submit a request.
        </div>
      ) : (
        <form className="space-y-6" onSubmit={handleSubmit}>
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
                You have {ptSessions} PT session{ptSessions === 1 ? "" : "s"} remaining.
                {computedSessionType === "2on1" ? " A 2-on-1 uses 2 sessions." : ""}
              </p>
            </div>
          )}

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
              {CLASS_TYPES.map((c) => (
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
                  <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_1fr_auto] gap-2">
                    <input
                      type="date"
                      min={todayIso()}
                      value={s.proposedDate}
                      onChange={(e) => setSlot(i, { proposedDate: e.target.value })}
                      className="rounded-lg border border-ink/10 bg-paper px-3 py-2 text-sm text-ink focus:outline-none focus:border-accent"
                      aria-label={`Slot ${i + 1} date`}
                    />
                    <input
                      type="time"
                      value={s.startTime}
                      onChange={(e) => setSlot(i, { startTime: e.target.value })}
                      className="rounded-lg border border-ink/10 bg-paper px-3 py-2 text-sm text-ink focus:outline-none focus:border-accent"
                      aria-label={`Slot ${i + 1} start time`}
                    />
                    <input
                      type="time"
                      value={s.endTime}
                      onChange={(e) => setSlot(i, { endTime: e.target.value })}
                      className="rounded-lg border border-ink/10 bg-paper px-3 py-2 text-sm text-ink focus:outline-none focus:border-accent"
                      aria-label={`Slot ${i + 1} end time`}
                    />
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

          {errors.length > 0 && (
            <ul className="rounded-xl border border-error/30 bg-error/10 p-3 text-xs text-error space-y-1">
              {errors.map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          )}

          <button
            type="submit"
            disabled={submitting || !hasEnoughCredits}
            className="w-full rounded-full bg-ink text-paper px-6 py-3 text-sm font-medium hover:bg-ink/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting ? "Submitting…" : `Submit request (uses ${required} session${required === 1 ? "" : "s"})`}
          </button>
        </form>
      )}
    </BookingSurface>
  );
}
