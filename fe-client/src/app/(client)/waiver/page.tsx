"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Check, ArrowRight } from "lucide-react";
import { AuthSplitShell } from "@/components/auth/auth-split-shell";
import { safeNextPath } from "@/lib/auth-redirect";
import { useCancellationPolicy } from "@/lib/cancellation-policy";

const WAIVER_TEXT = [
  {
    title: "1. Assumption of Risk",
    body: `By signing this waiver, you acknowledge that participation in yoga classes, wellness workshops, and related physical activities involves inherent risks, including but not limited to muscle strains, sprains, fractures, and other physical injuries. You understand that these activities require physical exertion and may push your body beyond its normal range of motion. You voluntarily assume all risks associated with your participation, whether known or unknown, foreseeable or unforeseeable.`,
  },
  {
    title: "2. Release of Liability",
    body: `In consideration of being permitted to participate in classes and activities offered by this studio, you hereby release, waive, discharge, and covenant not to sue the studio, its owners, operators, employees, instructors, agents, and affiliates from any and all liability, claims, demands, actions, or causes of action arising out of or related to any loss, damage, or injury, including death, that may be sustained by you during or as a result of your participation in any class or activity.`,
  },
  {
    title: "3. Medical Disclaimer",
    body: `You represent and warrant that you are physically fit and have no medical condition that would prevent your full participation in yoga classes and related activities. You acknowledge that it is your responsibility to consult with a physician prior to and regarding your participation. The studio does not provide medical advice, and its instructors are not licensed medical practitioners. If you experience any pain, discomfort, dizziness, or shortness of breath during any activity, you agree to stop immediately and notify the instructor.`,
  },
  {
    title: "4. Studio Policies and Conduct",
    body: `You agree to abide by all studio rules, policies, and guidelines as communicated by staff and instructors. You understand that the studio reserves the right to refuse service or remove any participant whose conduct is deemed inappropriate, disruptive, or unsafe. Late arrivals may be denied entry to a class in progress to maintain the experience for all participants. {CANCELLATION}`,
  },
  {
    title: "5. Personal Property and Privacy",
    body: `The studio is not responsible for any personal property that is lost, stolen, or damaged on the premises. You consent to the possible use of photographs or video recordings taken during classes for promotional purposes, unless you notify the studio in writing of your objection. All personal information collected by the studio shall be handled in accordance with applicable privacy laws and our posted privacy policy. This waiver shall be binding upon you, your heirs, executors, administrators, and assigns.`,
  },
];

/**
 * The cancellation sentence is the studio's own window, never a number written
 * here: each studio sets it, and a waiver that states another is wrong.
 */
function cancellationSentence(windowHours: number | null): string {
  if (windowHours === null) {
    return "Cancellations must be made within the studio's cancellation window; inside it a class cannot be self-cancelled and the session credit is forfeited.";
  }
  const hours = `${windowHours} ${windowHours === 1 ? "hour" : "hours"}`;
  return `Cancellations must be made at least ${hours} before the scheduled class time; inside that window a class cannot be self-cancelled and the session credit is forfeited.`;
}

/** How long the signed tick shows before the member is taken back. */
const RETURN_AFTER_MS = 1200;

function WaiverContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  // Only a path on this site: `?returnTo=https://…` must not send a member
  // who has just signed off somewhere else wearing the studio's address.
  const returnTo = safeNextPath(new URLSearchParams({ next: searchParams.get("returnTo") ?? "" }));
  const policy = useCancellationPolicy();
  const [acknowledged, setAcknowledged] = useState(false);
  const [signed, setSigned] = useState(false);
  const [signedAt, setSignedAt] = useState<Date | null>(null);

  const canSign = acknowledged;

  // Taken back once signed, unless they leave first.
  useEffect(() => {
    if (!signed || !returnTo) return;
    const t = setTimeout(() => router.push(returnTo), RETURN_AFTER_MS);
    return () => clearTimeout(t);
  }, [signed, returnTo, router]);

  function handleSign() {
    if (!canSign) return;
    try {
      sessionStorage.setItem("waiverSigned", "true");
    } catch {
      // Storage blocked: the signature still stands for this visit.
    }
    setSignedAt(new Date());
    setSigned(true);
  }

  const cancellation = cancellationSentence(policy?.class_window_hours ?? null);

  // The moment they signed, not the clock at render: a render-time `new Date()`
  // differs between the server's HTML and the hydrating render.
  const signedDateStr = signedAt?.toLocaleDateString("en-SG", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "Asia/Singapore",
  });
  const signedTimeStr = signedAt?.toLocaleTimeString("en-SG", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: "Asia/Singapore",
  });

  return (
    <AuthSplitShell
      imageKey="hero-pilates-01"
      quote="Practice safely. Practice well."
    >
      {!signed ? (
          <div key="form">
            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-ink">
              Studio waiver
            </h1>
            <p className="text-sm text-muted mt-2">
              Please read and acknowledge before your first class.
            </p>

            <div
              tabIndex={0}
              aria-label="Waiver terms"
              className="max-h-[45dvh] sm:max-h-80 overflow-y-auto overscroll-contain rounded-xl border border-ink/10 bg-paper p-4 sm:p-6 text-sm text-ink/80 leading-relaxed space-y-3 mt-5"
            >
              {WAIVER_TEXT.map((section) => (
                <p key={section.title}>
                  <strong className="font-semibold text-ink">
                    {section.title}.
                  </strong>{" "}
                  {section.body.replace("{CANCELLATION}", cancellation)}
                </p>
              ))}
            </div>

            <label className="flex min-h-[44px] items-start gap-3 mt-5 py-2 cursor-pointer">
              <input
                type="checkbox"
                checked={acknowledged}
                onChange={(e) => setAcknowledged(e.target.checked)}
                className="mt-0.5 h-5 w-5 shrink-0 accent-ink"
              />
              <span className="text-sm text-ink/80">
                I have read and agree to the terms above.
              </span>
            </label>

            <button
              type="button"
              onClick={handleSign}
              disabled={!canSign}
              className="w-full min-h-[48px] rounded-full bg-ink text-paper py-3 text-sm font-semibold hover:bg-ink/90 mt-4 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              I agree and sign
            </button>
          </div>
        ) : (
          <div key="success" className="text-center animate-fade-in">
            <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-ink celebrate-pop">
              <Check className="h-10 w-10 text-paper" strokeWidth={3} />
            </div>

            <h2 className="mt-6 text-2xl font-extrabold tracking-tight text-ink">
              Waiver signed
            </h2>
            <p className="mt-2 text-sm text-muted">
              {signedDateStr} at {signedTimeStr}
            </p>

            <Link
              href="/"
              className="mt-8 inline-flex w-full sm:w-auto min-h-[48px] items-center justify-center gap-2 rounded-full bg-ink text-paper px-6 py-3 text-sm font-semibold hover:bg-ink/90"
            >
              Continue to booking
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        )}
    </AuthSplitShell>
  );
}

export default function WaiverPage() {
  return (
    <Suspense fallback={null}>
      <WaiverContent />
    </Suspense>
  );
}
