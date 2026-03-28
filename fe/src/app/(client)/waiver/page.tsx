"use client";

import { useState, useRef, useCallback } from "react";
import Link from "next/link";
import { Check, ChevronDown, ArrowRight } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";

const inputClass =
  "w-full bg-warm border border-border rounded-md px-4 py-3 text-sm font-mono focus:ring-2 focus:ring-accent/30 focus:border-accent outline-none transition placeholder:text-muted";

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

export default function WaiverPage() {
  const [hasScrolledToBottom, setHasScrolledToBottom] = useState(false);
  const [fullName, setFullName] = useState("");
  const [signed, setSigned] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const canSign = hasScrolledToBottom && fullName.trim().length > 0;

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const threshold = 20;
    const atBottom =
      el.scrollHeight - el.scrollTop - el.clientHeight < threshold;
    if (atBottom && !hasScrolledToBottom) {
      setHasScrolledToBottom(true);
    }
  }, [hasScrolledToBottom]);

  function handleSign() {
    if (!canSign) return;
    setSigned(true);
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
    <div className="min-h-screen bg-paper px-4 py-12 sm:py-20">
      <div className="mx-auto max-w-2xl">
        <AnimatePresence mode="wait">
          {!signed ? (
            <motion.div
              key="form"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              transition={{ duration: 0.4 }}
            >
              {/* Heading */}
              <h1 className="font-serif text-3xl text-ink mb-2">
                Digital Waiver
              </h1>
              <p className="text-sm text-muted mb-6">
                Please read the full document before signing.
              </p>

              {/* Scrollable Document */}
              <div className="relative">
                <div
                  ref={scrollRef}
                  onScroll={handleScroll}
                  className="max-h-[400px] overflow-y-auto bg-warm rounded-lg p-6 border border-border"
                >
                  <div className="space-y-6">
                    {WAIVER_TEXT.map((section) => (
                      <div key={section.title}>
                        <h3 className="text-sm font-semibold text-ink mb-2">
                          {section.title}
                        </h3>
                        <p className="text-sm leading-relaxed text-ink/75">
                          {section.body}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Scroll hint */}
                <AnimatePresence>
                  {!hasScrolledToBottom && (
                    <motion.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      className="absolute bottom-0 left-0 right-0 flex items-center justify-center gap-1.5 bg-gradient-to-t from-warm via-warm/90 to-transparent pt-10 pb-3 rounded-b-[--radius-lg] pointer-events-none"
                    >
                      <ChevronDown className="h-4 w-4 text-muted animate-bounce" />
                      <span className="text-xs font-medium text-muted">
                        Scroll to read full document
                      </span>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {/* Signature Section */}
              <div className="mt-8 space-y-4">
                <div>
                  <label className="block text-xs font-medium text-muted mb-1.5">
                    Type your full name as your electronic signature
                  </label>
                  <input
                    type="text"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="Full name"
                    className={inputClass}
                  />
                </div>

                <button
                  type="button"
                  onClick={handleSign}
                  disabled={!canSign}
                  className={cn(
                    "w-full rounded-md py-3.5 text-sm font-semibold transition-all",
                    canSign
                      ? "bg-sage text-white hover:bg-sage/90 active:scale-[0.98] shadow-soft hover:shadow-hover"
                      : "bg-muted/30 text-muted cursor-not-allowed"
                  )}
                >
                  I Agree
                </button>

                {!hasScrolledToBottom && (
                  <p className="text-center text-xs text-muted">
                    You must scroll to the bottom of the waiver to continue.
                  </p>
                )}
              </div>
            </motion.div>
          ) : (
            <motion.div
              key="success"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.5 }}
              className="text-center"
            >
              <div className="mx-auto max-w-md rounded-lg border border-border bg-card p-8 shadow-soft">
                {/* Checkmark */}
                <motion.div
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{
                    type: "spring",
                    stiffness: 260,
                    damping: 20,
                    delay: 0.15,
                  }}
                  className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-sage"
                >
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 0.4 }}
                  >
                    <Check className="h-10 w-10 text-white" strokeWidth={3} />
                  </motion.div>
                </motion.div>

                <motion.div
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.5, duration: 0.4 }}
                >
                  <h2 className="mt-6 font-serif text-2xl text-ink">
                    Waiver Signed
                  </h2>
                  <p className="mt-2 text-sm text-muted">
                    {signedDateStr} at {signedTimeStr}
                  </p>
                  <p className="mt-1 text-sm text-muted">
                    Signed by:{" "}
                    <span className="font-mono text-ink">{fullName}</span>
                  </p>
                </motion.div>

                <motion.div
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.7, duration: 0.4 }}
                >
                  <Link
                    href="/sessions"
                    className={cn(
                      "mt-8 inline-flex items-center justify-center gap-2 rounded-md px-6 py-3 text-sm font-semibold text-white transition-all",
                      "bg-accent hover:bg-accent-deep active:scale-[0.98] shadow-soft hover:shadow-hover"
                    )}
                  >
                    Continue to Booking
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                </motion.div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
