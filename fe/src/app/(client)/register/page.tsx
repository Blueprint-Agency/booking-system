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

export default function RegisterPage() {
  return (
    <div className="min-h-[calc(100vh-64px)] flex items-center justify-center px-4 py-16 bg-warm">
      {/* Decorative glow */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/3 left-1/2 -translate-x-1/2 w-[600px] h-[400px] rounded-full bg-sage-light/30 blur-3xl" />
      </div>

      <motion.div
        initial="hidden"
        animate="visible"
        variants={fadeUp}
        className="relative w-full max-w-md"
      >
        <div className="bg-card rounded-xl shadow-hover border border-border p-8 sm:p-10">
          {/* Header */}
          <div className="text-center mb-8">
            <div className="w-12 h-12 rounded-lg bg-sage mx-auto mb-4 flex items-center justify-center">
              <svg
                width="22"
                height="22"
                viewBox="0 0 24 24"
                fill="none"
                stroke="white"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <line x1="19" y1="8" x2="19" y2="14" />
                <line x1="22" y1="11" x2="16" y2="11" />
              </svg>
            </div>
            <h1 className="font-serif text-2xl sm:text-3xl text-ink mb-2">
              Create your account
            </h1>
            <p className="text-sm text-muted">
              Start booking sessions in minutes
            </p>
          </div>

          {/* Form */}
          <form
            onSubmit={(e) => e.preventDefault()}
            className="space-y-4"
          >
            {/* Full Name */}
            <div>
              <label
                htmlFor="fullName"
                className="block text-sm font-medium text-ink mb-1.5"
              >
                Full name
              </label>
              <input
                id="fullName"
                type="text"
                placeholder="Jane Smith"
                className="w-full px-4 py-3 text-sm bg-warm border border-border rounded-md text-ink placeholder:text-muted/60 outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent transition-all duration-200"
              />
            </div>

            {/* Email */}
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

            {/* Phone */}
            <div>
              <label
                htmlFor="phone"
                className="block text-sm font-medium text-ink mb-1.5"
              >
                Phone number
              </label>
              <input
                id="phone"
                type="tel"
                placeholder="+65 9123 4567"
                className="w-full px-4 py-3 text-sm bg-warm border border-border rounded-md text-ink placeholder:text-muted/60 outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent transition-all duration-200"
              />
            </div>

            {/* Password */}
            <div>
              <label
                htmlFor="password"
                className="block text-sm font-medium text-ink mb-1.5"
              >
                Password
              </label>
              <input
                id="password"
                type="password"
                placeholder="At least 8 characters"
                className="w-full px-4 py-3 text-sm bg-warm border border-border rounded-md text-ink placeholder:text-muted/60 outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent transition-all duration-200"
              />
            </div>

            {/* Confirm Password */}
            <div>
              <label
                htmlFor="confirmPassword"
                className="block text-sm font-medium text-ink mb-1.5"
              >
                Confirm password
              </label>
              <input
                id="confirmPassword"
                type="password"
                placeholder="Repeat your password"
                className="w-full px-4 py-3 text-sm bg-warm border border-border rounded-md text-ink placeholder:text-muted/60 outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent transition-all duration-200"
              />
            </div>

            {/* Terms */}
            <label className="flex items-start gap-3 cursor-pointer group pt-1">
              <input
                type="checkbox"
                className="mt-0.5 w-4 h-4 rounded border-border text-accent focus:ring-accent/30 bg-warm shrink-0"
              />
              <span className="text-sm text-muted group-hover:text-ink transition-colors leading-snug">
                I agree to the{" "}
                <Link
                  href="#"
                  className="text-accent-deep hover:text-accent underline underline-offset-2"
                >
                  Terms of Service
                </Link>{" "}
                and{" "}
                <Link
                  href="#"
                  className="text-accent-deep hover:text-accent underline underline-offset-2"
                >
                  Privacy Policy
                </Link>
              </span>
            </label>

            {/* Submit */}
            <button
              type="submit"
              className="w-full py-3 text-sm font-semibold text-white bg-accent rounded-md hover:bg-accent-deep shadow-soft hover:shadow-hover transition-all duration-300 mt-2"
            >
              Create Account
            </button>
          </form>

          {/* Login link */}
          <p className="text-center text-sm text-muted mt-6">
            Already have an account?{" "}
            <Link
              href="/login"
              className="text-accent-deep font-medium hover:text-accent transition-colors"
            >
              Sign in
            </Link>
          </p>
        </div>
      </motion.div>
    </div>
  );
}
