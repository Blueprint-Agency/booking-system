"use client";

import Link from "next/link";
import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";

const fadeUp = {
  hidden: { opacity: 0, y: 32 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.1, duration: 0.6, ease: [0.22, 1, 0.36, 1] as const },
  }),
};

const INDUSTRIES = [
  "Fitness",
  "Arts & Crafts",
  "Cooking",
  "Music",
  "Wellness",
  "Education",
  "Other",
];

const PLANS = [
  {
    id: "starter",
    name: "Starter",
    price: "$29/mo",
    description: "Up to 5 sessions, 1 admin, basic analytics",
  },
  {
    id: "growth",
    name: "Growth",
    price: "$79/mo",
    description: "Unlimited sessions, 3 staff, full analytics",
    popular: true,
  },
  {
    id: "professional",
    name: "Professional",
    price: "$149/mo",
    description: "Unlimited everything, custom branding, API access",
  },
];

const STEP_LABELS = ["Account", "Business", "Plan", "Done"];

export default function BusinessRegisterPage() {
  const [step, setStep] = useState(1);

  // Step 1
  const [businessName, setBusinessName] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  // Step 2
  const [industry, setIndustry] = useState("");
  const [shortDescription, setShortDescription] = useState("");
  const [location, setLocation] = useState("");

  // Step 3
  const [selectedPlan, setSelectedPlan] = useState("growth");

  const canAdvance = () => {
    if (step === 1) return businessName && ownerName && email && password;
    if (step === 2) return industry && shortDescription && location;
    if (step === 3) return selectedPlan;
    return false;
  };

  return (
    <div className="min-h-[80vh] py-12 sm:py-20 px-6 sm:px-8">
      <div className="max-w-xl mx-auto">
        {/* Header */}
        <motion.div
          initial="hidden"
          animate="visible"
          custom={0}
          variants={fadeUp}
          className="text-center mb-10"
        >
          <h1 className="font-serif text-2xl sm:text-3xl lg:text-4xl text-ink mb-3">
            {step < 4 ? "Create your business account" : "Welcome aboard!"}
          </h1>
          {step < 4 && (
            <p className="text-muted text-base sm:text-lg">
              Step {step} of 3 — {STEP_LABELS[step - 1]}
            </p>
          )}
        </motion.div>

        {/* Progress bar */}
        {step < 4 && (
          <motion.div
            initial="hidden"
            animate="visible"
            custom={1}
            variants={fadeUp}
            className="mb-10"
          >
            <div className="flex items-center gap-2">
              {[1, 2, 3].map((s) => (
                <div
                  key={s}
                  className={cn(
                    "h-1.5 flex-1 rounded-full transition-all duration-500",
                    s <= step ? "bg-accent" : "bg-border"
                  )}
                />
              ))}
            </div>
          </motion.div>
        )}

        {/* Steps */}
        <AnimatePresence mode="wait">
          {step === 1 && (
            <motion.div
              key="step1"
              initial={{ opacity: 0, x: 40 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -40 }}
              transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
              className="space-y-5"
            >
              <div>
                <label className="block text-sm font-medium text-ink mb-1.5">
                  Business name
                </label>
                <input
                  type="text"
                  value={businessName}
                  onChange={(e) => setBusinessName(e.target.value)}
                  placeholder="e.g. Sunrise Yoga Studio"
                  className="w-full px-4 py-3 text-sm text-ink bg-warm border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent transition-all placeholder:text-muted/60"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-ink mb-1.5">
                  Owner name
                </label>
                <input
                  type="text"
                  value={ownerName}
                  onChange={(e) => setOwnerName(e.target.value)}
                  placeholder="Your full name"
                  className="w-full px-4 py-3 text-sm text-ink bg-warm border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent transition-all placeholder:text-muted/60"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-ink mb-1.5">
                  Email
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="w-full px-4 py-3 text-sm text-ink bg-warm border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent transition-all placeholder:text-muted/60"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-ink mb-1.5">
                  Password
                </label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Create a strong password"
                  className="w-full px-4 py-3 text-sm text-ink bg-warm border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent transition-all placeholder:text-muted/60"
                />
              </div>
            </motion.div>
          )}

          {step === 2 && (
            <motion.div
              key="step2"
              initial={{ opacity: 0, x: 40 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -40 }}
              transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
              className="space-y-5"
            >
              <div>
                <label className="block text-sm font-medium text-ink mb-1.5">
                  Industry
                </label>
                <select
                  value={industry}
                  onChange={(e) => setIndustry(e.target.value)}
                  className="w-full px-4 py-3 text-sm text-ink bg-warm border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent transition-all"
                >
                  <option value="">Select your industry</option>
                  {INDUSTRIES.map((ind) => (
                    <option key={ind} value={ind}>
                      {ind}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-ink mb-1.5">
                  Short description
                </label>
                <textarea
                  value={shortDescription}
                  onChange={(e) => setShortDescription(e.target.value)}
                  rows={3}
                  placeholder="Tell customers what you offer in 1-2 sentences"
                  className="w-full px-4 py-3 text-sm text-ink bg-warm border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent transition-all resize-none placeholder:text-muted/60"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-ink mb-1.5">
                  Location
                </label>
                <input
                  type="text"
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  placeholder="e.g. Tiong Bahru, Singapore"
                  className="w-full px-4 py-3 text-sm text-ink bg-warm border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent transition-all placeholder:text-muted/60"
                />
              </div>
            </motion.div>
          )}

          {step === 3 && (
            <motion.div
              key="step3"
              initial={{ opacity: 0, x: 40 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -40 }}
              transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
              className="space-y-4"
            >
              <p className="text-sm text-muted mb-2">
                Choose the plan that fits your business. You can change this later.
              </p>
              {PLANS.map((plan) => (
                <button
                  key={plan.id}
                  type="button"
                  onClick={() => setSelectedPlan(plan.id)}
                  className={cn(
                    "w-full text-left rounded-xl p-5 border-2 transition-all duration-300",
                    selectedPlan === plan.id
                      ? "border-accent bg-accent-glow/20 shadow-soft"
                      : "border-border bg-card hover:border-accent/40"
                  )}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="font-serif text-lg text-ink">
                          {plan.name}
                        </h3>
                        {plan.popular && (
                          <span className="px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider bg-accent text-white rounded-full">
                            Popular
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-muted">{plan.description}</p>
                    </div>
                    <span className="font-serif text-xl text-ink whitespace-nowrap">
                      {plan.price}
                    </span>
                  </div>
                  {selectedPlan === plan.id && (
                    <div className="mt-3 flex items-center gap-2 text-xs text-accent-deep font-medium">
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 16 16"
                        fill="none"
                      >
                        <path
                          d="M3.5 8.5L6.5 11.5L12.5 4.5"
                          stroke="currentColor"
                          strokeWidth="1.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                      Selected
                    </div>
                  )}
                </button>
              ))}
            </motion.div>
          )}

          {step === 4 && (
            <motion.div
              key="step4"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
              className="text-center py-8"
            >
              <div className="w-20 h-20 rounded-full bg-accent-glow/40 text-accent-deep flex items-center justify-center mx-auto mb-6">
                <svg
                  width="36"
                  height="36"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                  <polyline points="22 4 12 14.01 9 11.01" />
                </svg>
              </div>
              <h2 className="font-serif text-2xl sm:text-3xl text-ink mb-3">
                Your business is being set up!
              </h2>
              <p className="text-muted text-base sm:text-lg mb-8 max-w-md mx-auto">
                We&apos;re getting everything ready for <strong className="text-ink">{businessName}</strong>.
                You&apos;ll receive a confirmation email at <strong className="text-ink">{email}</strong> shortly.
              </p>
              <Link
                href="/explore"
                className="inline-block px-8 py-3.5 text-sm font-semibold text-white bg-accent rounded-md hover:bg-accent-deep shadow-soft hover:shadow-hover transition-all duration-300"
              >
                Explore the Marketplace
              </Link>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Navigation buttons */}
        {step < 4 && (
          <motion.div
            initial="hidden"
            animate="visible"
            custom={3}
            variants={fadeUp}
            className="flex items-center justify-between mt-10"
          >
            <button
              type="button"
              onClick={() => setStep(Math.max(1, step - 1))}
              disabled={step === 1}
              className={cn(
                "px-6 py-3 text-sm font-semibold rounded-md transition-all duration-300",
                step === 1
                  ? "text-muted/40 cursor-not-allowed"
                  : "text-accent-deep border-2 border-accent-glow hover:bg-accent-glow/20"
              )}
            >
              Back
            </button>
            <button
              type="button"
              onClick={() => {
                if (canAdvance()) setStep(step + 1);
              }}
              disabled={!canAdvance()}
              className={cn(
                "px-8 py-3 text-sm font-semibold rounded-md transition-all duration-300",
                canAdvance()
                  ? "text-white bg-accent hover:bg-accent-deep shadow-soft hover:shadow-hover"
                  : "text-white/60 bg-accent/40 cursor-not-allowed"
              )}
            >
              {step === 3 ? "Complete Setup" : "Continue"}
            </button>
          </motion.div>
        )}
      </div>
    </div>
  );
}
