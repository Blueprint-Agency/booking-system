"use client";

import { useState } from "react";
import { SectionHeading } from "@/components/booking/section-heading";
import { AccountMobileNav } from "@/components/account/account-mobile-nav";

export default function ProfilePage() {
  const [firstName, setFirstName] = useState("Sarah");
  const [lastName, setLastName] = useState("Kim");
  const [dob, setDob] = useState("1992-05-14");
  const [phone, setPhone] = useState("+65 9123 4567");
  const [addressLine1, setAddressLine1] = useState("12 Kim Seng Road");
  const [addressLine2, setAddressLine2] = useState("#08-21");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSaved(false);
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
    "rounded-xl border border-ink/10 bg-paper px-4 py-3 text-sm w-full focus:border-accent focus:outline-none";
  const labelClass =
    "text-xs uppercase tracking-wider text-muted mb-2 block";
  const cardClass =
    "rounded-2xl bg-paper border border-ink/10 p-8 space-y-6";

  return (
    <div>
      <SectionHeading
        eyebrow="Profile"
        title="Account details"
        description="Keep your info current so we can reach you."
      />
      <AccountMobileNav />

      <form onSubmit={handleSave} className="mt-8">
        <div className="space-y-6">
          {/* Personal info */}
          <section className={cardClass}>
            <h3 className="font-serif text-lg text-ink">Personal info</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label htmlFor="firstName" className={labelClass}>
                  First name
                </label>
                <input
                  id="firstName"
                  type="text"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  className={inputClass}
                />
              </div>
              <div>
                <label htmlFor="lastName" className={labelClass}>
                  Last name
                </label>
                <input
                  id="lastName"
                  type="text"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  className={inputClass}
                />
              </div>
              <div>
                <label htmlFor="dob" className={labelClass}>
                  Date of birth
                </label>
                <input
                  id="dob"
                  type="date"
                  value={dob}
                  onChange={(e) => setDob(e.target.value)}
                  className={inputClass}
                />
              </div>
            </div>
          </section>

          {/* Contact */}
          <section className={cardClass}>
            <h3 className="font-serif text-lg text-ink">Contact</h3>
            <div className="space-y-4">
              <div>
                <label htmlFor="email" className={labelClass}>
                  Email
                </label>
                <input
                  id="email"
                  type="email"
                  value="sarah@example.com"
                  readOnly
                  className={`${inputClass} text-muted cursor-not-allowed`}
                />
                <p className="text-xs text-muted mt-2">
                  Contact support to change your email address.
                </p>
              </div>
              <div>
                <label htmlFor="phone" className={labelClass}>
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
              <div>
                <label htmlFor="addressLine1" className={labelClass}>
                  Address line 1
                </label>
                <input
                  id="addressLine1"
                  type="text"
                  value={addressLine1}
                  onChange={(e) => setAddressLine1(e.target.value)}
                  className={inputClass}
                />
              </div>
              <div>
                <label htmlFor="addressLine2" className={labelClass}>
                  Address line 2
                </label>
                <input
                  id="addressLine2"
                  type="text"
                  value={addressLine2}
                  onChange={(e) => setAddressLine2(e.target.value)}
                  className={inputClass}
                />
              </div>
            </div>
          </section>

          {/* Security */}
          <section className={cardClass}>
            <h3 className="font-serif text-lg text-ink">Security</h3>
            <div className="space-y-4">
              <div>
                <label htmlFor="currentPassword" className={labelClass}>
                  Current password
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
                <label htmlFor="newPassword" className={labelClass}>
                  New password
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
                <label htmlFor="confirmPassword" className={labelClass}>
                  Confirm new password
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
            <div className="flex justify-end">
              <button
                type="button"
                className="rounded-full bg-ink text-paper px-5 py-3 text-sm font-medium"
              >
                Change password
              </button>
            </div>
          </section>
        </div>

        {/* Footer action bar */}
        <div className="mt-8 flex justify-end gap-3 items-center">
          {saved && (
            <span className="text-sm text-sage font-medium mr-2">
              Changes saved successfully
            </span>
          )}
          <button
            type="button"
            className="rounded-full border border-ink/10 px-5 py-3 text-sm"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            className="rounded-full bg-ink text-paper px-5 py-3 text-sm font-medium disabled:opacity-60"
          >
            {saving ? "Saving..." : "Save changes"}
          </button>
        </div>
      </form>
    </div>
  );
}
