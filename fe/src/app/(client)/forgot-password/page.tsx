"use client";

import { useState } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";

const fadeUp = {
  hidden: { opacity: 0, y: 24 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.5, ease: [0.22, 1, 0.36, 1] as const },
  },
};

export default function ForgotPasswordPage() {
  const [sent, setSent] = useState(false);

  return (
    <div className="min-h-[calc(100vh-64px)] flex items-center justify-center px-4 py-16 bg-warm">
      {/* Decorative glow */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/3 left-1/2 -translate-x-1/2 w-[500px] h-[350px] rounded-full bg-accent-glow/15 blur-3xl" />
      </div>

      <motion.div
        initial="hidden"
        animate="visible"
        variants={fadeUp}
        className="relative w-full max-w-md"
      >
        <div className="bg-card rounded-xl shadow-hover border border-border p-8 sm:p-10">
          <AnimatePresence mode="wait">
            {!sent ? (
              <motion.div
                key="form"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -12 }}
                transition={{ duration: 0.3 }}
              >
                {/* Header */}
                <div className="text-center mb-8">
                  <div className="w-14 h-14 rounded-full bg-warning-bg mx-auto mb-5 flex items-center justify-center">
                    <svg
                      width="26"
                      height="26"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="var(--color-warning)"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <rect
                        x="3"
                        y="11"
                        width="18"
                        height="11"
                        rx="2"
                        ry="2"
                      />
                      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                      <circle cx="12" cy="16" r="1" />
                    </svg>
                  </div>
                  <h1 className="font-serif text-2xl sm:text-3xl text-ink mb-2">
                    Forgot your password?
                  </h1>
                  <p className="text-sm text-muted">
                    No worries. Enter your email and we&apos;ll send you a reset
                    link.
                  </p>
                </div>

                {/* Form */}
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    setSent(true);
                  }}
                  className="space-y-5"
                >
                  <div>
                    <label
                      htmlFor="email"
                      className="block text-sm font-medium text-ink mb-1.5"
                    >
                      Email address
                    </label>
                    <input
                      id="email"
                      type="email"
                      placeholder="you@example.com"
                      className="w-full px-4 py-3 text-sm bg-warm border border-border rounded-md text-ink placeholder:text-muted/60 outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent transition-all duration-200"
                    />
                  </div>

                  <button
                    type="submit"
                    className="w-full py-3 text-sm font-semibold text-white bg-accent rounded-md hover:bg-accent-deep shadow-soft hover:shadow-hover transition-all duration-300"
                  >
                    Send Reset Link
                  </button>
                </form>

                <p className="text-center text-sm text-muted mt-6">
                  Remember your password?{" "}
                  <Link
                    href="/login"
                    className="text-accent-deep font-medium hover:text-accent transition-colors"
                  >
                    Sign in
                  </Link>
                </p>
              </motion.div>
            ) : (
              <motion.div
                key="success"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -12 }}
                transition={{ duration: 0.3 }}
                className="text-center"
              >
                {/* Success state */}
                <div className="w-16 h-16 rounded-full bg-sage-light mx-auto mb-6 flex items-center justify-center">
                  <svg
                    width="28"
                    height="28"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="var(--color-sage)"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M20 6 9 17l-5-5" />
                  </svg>
                </div>

                <h1 className="font-serif text-2xl sm:text-3xl text-ink mb-3">
                  Check your email
                </h1>

                <p className="text-sm text-muted leading-relaxed mb-6">
                  If an account exists with that email, we&apos;ve sent
                  instructions to reset your password. The link expires in 1
                  hour.
                </p>

                <div className="space-y-3">
                  <button
                    type="button"
                    onClick={() => setSent(false)}
                    className="w-full py-3 text-sm font-semibold text-accent-deep border-2 border-accent-glow rounded-md hover:bg-accent-glow/20 transition-all duration-300"
                  >
                    Try a different email
                  </button>
                  <Link
                    href="/login"
                    className="block w-full py-3 text-sm font-medium text-muted hover:text-ink transition-colors"
                  >
                    Back to sign in
                  </Link>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.div>
    </div>
  );
}
