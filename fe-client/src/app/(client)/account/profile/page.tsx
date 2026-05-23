"use client";

import { useEffect, useState } from "react";
import { useUser, useClerk } from "@clerk/nextjs";
import { SectionHeading } from "@/components/booking/section-heading";
import { AccountMobileNav } from "@/components/account/account-mobile-nav";
import { ApiError, useApi } from "@/lib/api";

interface ApiClientProfile {
  id: string;
  name: string;
  email: string;
  phone: string;
  joined_at: string;
}

function splitName(full: string): { first: string; last: string } {
  const trimmed = full.trim();
  if (!trimmed) return { first: "", last: "" };
  const idx = trimmed.indexOf(" ");
  if (idx === -1) return { first: trimmed, last: "" };
  return {
    first: trimmed.slice(0, idx),
    last: trimmed.slice(idx + 1).trim(),
  };
}

export default function ProfilePage() {
  const api = useApi();
  const { user } = useUser();
  const { openUserProfile } = useClerk();

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Initial load. clerkClientAuth on the BE auto-provisions the row from token
  // claims if the webhook hasn't fired yet, so GET /me should always return a
  // row for an authenticated session.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .get<ApiClientProfile>("/me")
      .then((profile) => {
        if (cancelled) return;
        const { first, last } = splitName(profile.name);
        setFirstName(first);
        setLastName(last);
        setPhone(profile.phone);
        setEmail(profile.email);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(
          err instanceof ApiError
            ? `Couldn't load your profile (HTTP ${err.status}).`
            : "Couldn't load your profile.",
        );
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [api]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (saving || loading) return;
    setSaving(true);
    setSaved(false);
    setError(null);
    const first = firstName.trim();
    const last = lastName.trim();
    const joinedName = `${first} ${last}`.trim();
    if (!joinedName) {
      setError("Name can't be empty.");
      setSaving(false);
      return;
    }
    try {
      // Clerk first: this is the source of truth for first/last name (the
      // `user.updated` webhook will sync the joined name back to the BE row).
      // BE second: persists `phone` (which Clerk doesn't store) and ensures
      // the BE row reflects the change before the webhook lands.
      if (user) {
        await user.update({ firstName: first, lastName: last });
      }
      await api.patch<ApiClientProfile>("/me", {
        name: joinedName,
        phone: phone.trim(),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? `Couldn't save (HTTP ${err.status}).`
          : "Couldn't save. Please try again.",
      );
    } finally {
      setSaving(false);
    }
  }

  const inputClass =
    "rounded-xl border border-ink/10 bg-paper px-4 py-3 text-sm w-full focus:border-accent focus:outline-none";
  const labelClass = "text-xs uppercase tracking-wider text-muted mb-2 block";
  const cardClass = "rounded-2xl bg-paper border border-ink/10 p-8 space-y-6";

  return (
    <div>
      <SectionHeading
        eyebrow="Profile"
        title="Account details"
        description="Keep your info current so we can reach you."
      />
      <AccountMobileNav />

      <form onSubmit={handleSave} className="mt-8" aria-busy={loading}>
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
                  disabled={loading}
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
                  disabled={loading}
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
                  value={email}
                  readOnly
                  className={`${inputClass} text-muted cursor-not-allowed`}
                />
                <p className="text-xs text-muted mt-2">
                  To change your email, open “Manage account” in the Security
                  section below.
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
                  disabled={loading}
                  className={inputClass}
                />
              </div>
            </div>
          </section>

          {/* Security — delegated to Clerk's hosted UserProfile so password,
              2FA, email addresses, and active sessions all work without
              re-implementing the auth UI. */}
          <section className={cardClass}>
            <h3 className="font-serif text-lg text-ink">Security</h3>
            <p className="text-sm text-muted">
              Update your password, enable two-factor auth, or manage signed-in
              devices through your account settings.
            </p>
            <div className="flex justify-start">
              <button
                type="button"
                onClick={() => openUserProfile()}
                className="rounded-full bg-ink text-paper px-5 py-3 text-sm font-medium"
              >
                Manage account
              </button>
            </div>
          </section>
        </div>

        {/* Footer action bar */}
        <div className="mt-8 flex flex-wrap justify-end gap-3 items-center">
          {error && (
            <span className="text-sm text-red-600 font-medium mr-2">
              {error}
            </span>
          )}
          {saved && (
            <span className="text-sm text-sage font-medium mr-2">
              Changes saved successfully
            </span>
          )}
          <button
            type="submit"
            disabled={saving || loading}
            className="rounded-full bg-ink text-paper px-5 py-3 text-sm font-medium disabled:opacity-60"
          >
            {saving ? "Saving..." : loading ? "Loading..." : "Save changes"}
          </button>
        </div>
      </form>
    </div>
  );
}
