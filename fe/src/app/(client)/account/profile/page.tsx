"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

const fadeUp = {
  hidden: { opacity: 0, y: 20 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.08, duration: 0.5, ease: [0.22, 1, 0.36, 1] as const },
  }),
};

export default function ProfilePage() {
  const [name, setName] = useState("Sarah Kim");
  const [phone, setPhone] = useState("+65 9123 4567");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSaved(false);
    // Mock save delay
    setTimeout(() => {
      setSaving(false);
      setSaved(true);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setTimeout(() => setSaved(false), 3000);
    }, 1200);
  }

  const inputClass =
    "w-full px-4 py-2.5 text-sm bg-warm border border-border rounded-md text-ink placeholder:text-muted/60 focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent transition-colors duration-200";

  return (
    <div>
      <motion.h2
        initial="hidden"
        animate="visible"
        custom={0}
        variants={fadeUp}
        className="font-serif text-xl text-ink mb-6"
      >
        Profile
      </motion.h2>

      <form onSubmit={handleSave} className="max-w-lg space-y-8">
        {/* Personal Info */}
        <motion.div
          initial="hidden"
          animate="visible"
          custom={1}
          variants={fadeUp}
          className="bg-card border border-border rounded-lg p-6"
        >
          <h3 className="font-serif text-lg text-ink mb-5">Personal Info</h3>

          <div className="space-y-4">
            <div>
              <label
                htmlFor="name"
                className="block text-sm font-medium text-ink mb-1.5"
              >
                Full Name
              </label>
              <input
                id="name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className={inputClass}
              />
            </div>

            <div>
              <label
                htmlFor="email"
                className="block text-sm font-medium text-ink mb-1.5"
              >
                Email
              </label>
              <div className="relative">
                <input
                  id="email"
                  type="email"
                  value="sarah@example.com"
                  readOnly
                  className={cn(inputClass, "pr-10 text-muted cursor-not-allowed bg-warm/60")}
                />
                <svg
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted"
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                  <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                </svg>
              </div>
              <p className="text-xs text-muted mt-1">
                Contact support to change your email address.
              </p>
            </div>

            <div>
              <label
                htmlFor="phone"
                className="block text-sm font-medium text-ink mb-1.5"
              >
                Phone
              </label>
              <input
                id="phone"
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className={inputClass}
              />
            </div>
          </div>
        </motion.div>

        {/* Change Password */}
        <motion.div
          initial="hidden"
          animate="visible"
          custom={2}
          variants={fadeUp}
          className="bg-card border border-border rounded-lg p-6"
        >
          <h3 className="font-serif text-lg text-ink mb-5">Change Password</h3>

          <div className="space-y-4">
            <div>
              <label
                htmlFor="currentPassword"
                className="block text-sm font-medium text-ink mb-1.5"
              >
                Current Password
              </label>
              <input
                id="currentPassword"
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                placeholder="Enter current password"
                className={inputClass}
              />
            </div>

            <div>
              <label
                htmlFor="newPassword"
                className="block text-sm font-medium text-ink mb-1.5"
              >
                New Password
              </label>
              <input
                id="newPassword"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Enter new password"
                className={inputClass}
              />
            </div>

            <div>
              <label
                htmlFor="confirmPassword"
                className="block text-sm font-medium text-ink mb-1.5"
              >
                Confirm New Password
              </label>
              <input
                id="confirmPassword"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Confirm new password"
                className={inputClass}
              />
            </div>
          </div>
        </motion.div>

        {/* Save button */}
        <motion.div
          initial="hidden"
          animate="visible"
          custom={3}
          variants={fadeUp}
          className="flex items-center gap-4"
        >
          <button
            type="submit"
            disabled={saving}
            className={cn(
              "px-6 py-2.5 text-sm font-medium text-white rounded-md transition-all duration-200",
              saving
                ? "bg-accent/60 cursor-not-allowed"
                : "bg-accent hover:bg-accent-deep"
            )}
          >
            {saving ? (
              <span className="flex items-center gap-2">
                <svg
                  className="animate-spin h-4 w-4"
                  viewBox="0 0 24 24"
                  fill="none"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                  />
                </svg>
                Saving...
              </span>
            ) : (
              "Save Changes"
            )}
          </button>

          {saved && (
            <motion.span
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              className="text-sm text-sage font-medium"
            >
              Changes saved successfully
            </motion.span>
          )}
        </motion.div>
      </form>
    </div>
  );
}
