"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Check, ArrowRight } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { AuthSplitShell } from "@/components/auth/auth-split-shell";

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
    body: `You agree to abide by all studio rules, policies, and guidelines as communicated by staff and instructors. You understand that the studio reserves the right to refuse service or remove any participant whose conduct is deemed inappropriate, disruptive, or unsafe. Late arrivals may be denied entry to a class in progress to maintain the experience for all participants. Cancellations must be made at least 12 hours prior to the scheduled class time to avoid forfeiture of a session credit.`,
  },
  {
    title: "5. Personal Property and Privacy",
    body: `The studio is not responsible for any personal property that is lost, stolen, or damaged on the premises. You consent to the possible use of photographs or video recordings taken during classes for promotional purposes, unless you notify the studio in writing of your objection. All personal information collected by the studio shall be handled in accordance with applicable privacy laws and our posted privacy policy. This waiver shall be binding upon you, your heirs, executors, administrators, and assigns.`,
  },
];

function WaiverContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const returnTo = searchParams.get("returnTo");
  const [acknowledged, setAcknowledged] = useState(false);
  const [fullName, setFullName] = useState("");
  const [signed, setSigned] = useState(false);

  const canSign = acknowledged && fullName.trim().length > 0;

  function handleSign() {
    if (!canSign) return;
    if (typeof window !== "undefined") {
      sessionStorage.setItem("waiverSigned", "true");
    }
    setSigned(true);
    if (returnTo) {
      setTimeout(() => router.push(returnTo), 1200);
    }
  }

  const now = new Date();
  const signedDateStr = now.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const signedTimeStr = now.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });

  return (
    <AuthSplitShell
      imageKey="hero-pilates-01"
      quote="Practice safely. Practice well."
    >
      <AnimatePresence mode="wait">
        {!signed ? (
          <motion.div
            key="form"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{ duration: 0.4 }}
          >
            <h1 className="text-3xl font-extrabold tracking-tight text-ink">
              Studio waiver
            </h1>
            <p className="text-sm text-muted mt-2">
              Please read and acknowledge before your first class.
            </p>

            <div className="max-h-80 overflow-y-auto rounded-xl border border-ink/10 bg-warm p-6 text-sm text-ink/80 leading-relaxed space-y-3 mt-6">
              {WAIVER_TEXT.map((section) => (
                <p key={section.title}>
                  <strong className="font-semibold text-ink">
                    {section.title}.
                  </strong>{" "}
                  {section.body}
                </p>
              ))}
            </div>

            <label className="flex items-start gap-3 mt-6 cursor-pointer">
              <input
                type="checkbox"
                checked={acknowledged}
                onChange={(e) => setAcknowledged(e.target.checked)}
                className="mt-0.5 h-4 w-4 accent-ink"
              />
              <span className="text-sm text-ink/80">
                I have read and agree to the terms above.
              </span>
            </label>

            <div className="flex gap-3 mt-4">
              <input
                type="text"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Type your full name"
                className="flex-1 rounded-xl border border-ink/10 bg-paper px-4 py-3 text-sm font-mono focus:border-accent focus:outline-none"
              />
            </div>

            <button
              type="button"
              onClick={handleSign}
              disabled={!canSign}
              className="w-full rounded-full bg-ink text-paper py-3 text-sm font-medium hover:bg-ink/90 mt-6 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              I agree and sign
            </button>
          </motion.div>
        ) : (
          <motion.div
            key="success"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.5 }}
            className="text-center"
          >
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{
                type: "spring",
                stiffness: 260,
                damping: 20,
                delay: 0.15,
              }}
              className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-ink"
            >
              <Check className="h-10 w-10 text-paper" strokeWidth={3} />
            </motion.div>

            <h2 className="mt-6 text-2xl font-extrabold tracking-tight text-ink">
              Waiver signed
            </h2>
            <p className="mt-2 text-sm text-muted">
              {signedDateStr} at {signedTimeStr}
            </p>
            <p className="mt-1 text-sm text-muted">
              Signed by:{" "}
              <span className="font-mono text-ink">{fullName}</span>
            </p>

            <Link
              href="/classes"
              className="mt-8 inline-flex items-center justify-center gap-2 rounded-full bg-ink text-paper px-6 py-3 text-sm font-medium hover:bg-ink/90"
            >
              Continue to booking
              <ArrowRight className="h-4 w-4" />
            </Link>
          </motion.div>
        )}
      </AnimatePresence>
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
