"use client";

import Link from "next/link";
import { motion } from "framer-motion";

const fadeUp = {
  hidden: { opacity: 0, y: 24 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.5, ease: [0.22, 1, 0.36, 1] as const },
  },
};

export default function VerifyEmailPage() {
  return (
    <div className="min-h-[calc(100vh-64px)] flex items-center justify-center px-4 py-16 bg-warm">
      {/* Decorative glow */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/3 left-1/2 -translate-x-1/2 w-[500px] h-[350px] rounded-full bg-info-bg/40 blur-3xl" />
      </div>

      <motion.div
        initial="hidden"
        animate="visible"
        variants={fadeUp}
        className="relative w-full max-w-md"
      >
        <div className="bg-card rounded-xl shadow-hover border border-border p-8 sm:p-10 text-center">
          {/* Envelope icon */}
          <div className="w-16 h-16 rounded-full bg-info-bg mx-auto mb-6 flex items-center justify-center">
            <svg
              width="28"
              height="28"
              viewBox="0 0 24 24"
              fill="none"
              stroke="var(--color-info)"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect x="2" y="4" width="20" height="16" rx="2" />
              <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
            </svg>
          </div>

          <h1 className="font-serif text-2xl sm:text-3xl text-ink mb-3">
            Check your inbox
          </h1>

          <p className="text-muted text-sm leading-relaxed mb-2">
            We&apos;ve sent a verification link to
          </p>
          <p className="text-ink font-medium text-sm mb-6">
            jane@example.com
          </p>

          <div className="bg-warm rounded-md p-4 mb-8">
            <p className="text-sm text-muted leading-relaxed">
              Click the link in the email to verify your account. If you
              don&apos;t see it, check your spam folder. The link expires in 24
              hours.
            </p>
          </div>

          {/* Resend */}
          <button
            type="button"
            className="w-full py-3 text-sm font-semibold text-accent-deep border-2 border-accent-glow rounded-md hover:bg-accent-glow/20 transition-all duration-300 mb-4"
          >
            Resend Verification Email
          </button>

          <p className="text-sm text-muted">
            Wrong email?{" "}
            <Link
              href="/register"
              className="text-accent-deep font-medium hover:text-accent transition-colors"
            >
              Go back
            </Link>
          </p>
        </div>
      </motion.div>
    </div>
  );
}
