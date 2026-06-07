"use client";

import { useEffect, useState } from "react";
import { useUser, useClerk } from "@clerk/nextjs";
import { Lock } from "lucide-react";
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

function clerkErrorMessage(err: unknown): string | null {
  const e = err as { errors?: Array<{ message?: string }> };
  return e?.errors?.[0]?.message ?? null;
}

const inputClass =
  "rounded-xl border border-ink/10 bg-paper px-4 py-3 text-sm w-full focus:border-accent focus:outline-none";
const readOnlyClass =
  "rounded-xl border border-ink/10 bg-warm px-4 py-3 text-sm w-full text-muted cursor-not-allowed";
const labelClass = "text-xs uppercase tracking-wider text-muted mb-2 block";
const cardClass = "rounded-2xl bg-paper border border-ink/10 p-8 space-y-6";

export default function ProfilePage() {
  const api = useApi();
  const { user } = useUser();
  const { signOut } = useClerk();

  // Personal info (name) — editable.
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Password — change in place.
  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [pwSaving, setPwSaving] = useState(false);
  const [pwSaved, setPwSaved] = useState(false);
  const [pwError, setPwError] = useState<string | null>(null);

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
      // Clerk is the source of truth for first/last name (the `user.updated`
      // webhook syncs the joined name back to the BE row). We also PATCH /me so
      // the BE row reflects the change immediately. Phone/email are not editable.
      if (user) {
        await user.update({ firstName: first, lastName: last });
      }
      await api.patch<ApiClientProfile>("/me", { name: joinedName });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? `Couldn't save (HTTP ${err.status}).`
          : clerkErrorMessage(err) ?? "Couldn't save. Please try again.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function handlePasswordChange(e: React.FormEvent) {
    e.preventDefault();
    if (pwSaving) return;
    setPwError(null);
    setPwSaved(false);
    if (newPw.length < 8) {
      setPwError("New password must be at least 8 characters.");
      return;
    }
    if (newPw !== confirmPw) {
      setPwError("New passwords don't match.");
      return;
    }
    if (!user) return;
    setPwSaving(true);
    try {
      await user.updatePassword({
        currentPassword: currentPw,
        newPassword: newPw,
      });
      setPwSaved(true);
      setCurrentPw("");
      setNewPw("");
      setConfirmPw("");
      setTimeout(() => setPwSaved(false), 3000);
    } catch (err) {
      setPwError(clerkErrorMessage(err) ?? "Couldn't update your password.");
    } finally {
      setPwSaving(false);
    }
  }

  return (
    <div>
      <SectionHeading
        eyebrow="Profile"
        title="Account details"
        description="Keep your info current so we can reach you."
      />
      <AccountMobileNav />

      <div className="mt-8 space-y-6">
        {/* Name + contact */}
        <form onSubmit={handleSave} aria-busy={loading}>
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

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label htmlFor="email" className={labelClass}>
                  Email
                </label>
                <div className="relative">
                  <input
                    id="email"
                    type="email"
                    value={email}
                    readOnly
                    className={readOnlyClass}
                  />
                  <Lock className="h-4 w-4 text-muted absolute right-4 top-1/2 -translate-y-1/2" />
                </div>
              </div>
              <div>
                <label htmlFor="phone" className={labelClass}>
                  Phone
                </label>
                <div className="relative">
                  <input
                    id="phone"
                    type="tel"
                    value={phone}
                    readOnly
                    className={readOnlyClass}
                  />
                  <Lock className="h-4 w-4 text-muted absolute right-4 top-1/2 -translate-y-1/2" />
                </div>
              </div>
            </div>
            <p className="text-xs text-muted">
              Email and phone can&apos;t be changed here. Contact the studio if
              you need to update them.
            </p>

            <div className="flex flex-wrap justify-end gap-3 items-center pt-2">
              {error && (
                <span className="text-sm text-red-600 font-medium mr-2">
                  {error}
                </span>
              )}
              {saved && (
                <span className="text-sm text-sage font-medium mr-2">
                  Changes saved
                </span>
              )}
              <button
                type="submit"
                disabled={saving || loading}
                className="rounded-full bg-ink text-paper px-5 py-3 text-sm font-medium disabled:opacity-60"
              >
                {saving ? "Saving…" : loading ? "Loading…" : "Save changes"}
              </button>
            </div>
          </section>
        </form>

        {/* Password */}
        <form onSubmit={handlePasswordChange}>
          <section className={cardClass}>
            <div>
              <h3 className="font-serif text-lg text-ink">Password</h3>
              <p className="text-sm text-muted mt-1">
                Choose a strong password you don&apos;t use elsewhere.
              </p>
            </div>
            <div className="space-y-4">
              <div>
                <label htmlFor="currentPw" className={labelClass}>
                  Current password
                </label>
                <input
                  id="currentPw"
                  type="password"
                  autoComplete="current-password"
                  value={currentPw}
                  onChange={(e) => setCurrentPw(e.target.value)}
                  className={inputClass}
                />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="newPw" className={labelClass}>
                    New password
                  </label>
                  <input
                    id="newPw"
                    type="password"
                    autoComplete="new-password"
                    value={newPw}
                    onChange={(e) => setNewPw(e.target.value)}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label htmlFor="confirmPw" className={labelClass}>
                    Confirm new password
                  </label>
                  <input
                    id="confirmPw"
                    type="password"
                    autoComplete="new-password"
                    value={confirmPw}
                    onChange={(e) => setConfirmPw(e.target.value)}
                    className={inputClass}
                  />
                </div>
              </div>
            </div>

            <div className="flex flex-wrap justify-between gap-3 items-center pt-2">
              <button
                type="button"
                onClick={() => signOut({ redirectUrl: "/login?reset=1" })}
                className="text-sm text-accent-deep font-medium"
              >
                Forgot your password?
              </button>
              <div className="flex flex-wrap items-center gap-3">
                {pwError && (
                  <span className="text-sm text-red-600 font-medium">
                    {pwError}
                  </span>
                )}
                {pwSaved && (
                  <span className="text-sm text-sage font-medium">
                    Password updated
                  </span>
                )}
                <button
                  type="submit"
                  disabled={pwSaving}
                  className="rounded-full bg-ink text-paper px-5 py-3 text-sm font-medium disabled:opacity-60"
                >
                  {pwSaving ? "Updating…" : "Update password"}
                </button>
              </div>
            </div>
          </section>
        </form>
      </div>
    </div>
  );
}
