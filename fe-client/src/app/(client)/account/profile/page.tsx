"use client";

import { useEffect, useState } from "react";
import { Lock } from "lucide-react";
import { ChangePasswordCard } from "@/components/account/change-password-card";
import { SavedCardsCard } from "@/components/account/saved-cards-card";
import { AccountPageHeader } from "@/components/account/account-page-header";
import { ApiError, useApi } from "@/lib/api";
import { refreshAppUser } from "@/lib/auth";

interface ApiClientProfile {
  id: string;
  name: string;
  email: string;
  phone: string;
  gender: Gender | null;
  joined_at: string;
}

type Gender = "female" | "male" | "non_binary" | "prefer_not_to_say";

// The member's own answer (#281), and theirs to take back: "Not set" clears it.
const GENDERS: { value: Gender; label: string }[] = [
  { value: "female", label: "Female" },
  { value: "male", label: "Male" },
  { value: "non_binary", label: "Non-binary" },
  { value: "prefer_not_to_say", label: "Prefer not to say" },
];

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

const inputClass =
  "min-h-[44px] rounded-xl border border-ink/10 bg-card px-4 py-2.5 text-sm w-full focus:border-accent focus:ring-2 focus:ring-accent/15 focus:outline-none transition-shadow disabled:opacity-60";
const readOnlyClass =
  "min-h-[44px] rounded-xl border border-transparent bg-ink/[0.04] pl-4 pr-10 py-2.5 text-sm w-full text-muted cursor-not-allowed";
const labelClass = "text-sm font-semibold text-ink mb-1.5 block";
const cardClass = "rounded-2xl bg-card border border-ink/5 shadow-soft p-5 sm:p-6 space-y-5";

export default function ProfilePage() {
  const api = useApi();

  // Personal info (name) — editable.
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [gender, setGender] = useState<Gender | "">("");
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Initial load. A signed-in member always has a row here: registration and an
  // admin adding a member both write it alongside the account.
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
        setGender(profile.gender ?? "");
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
      // The member's row at this studio is the one source of truth for their
      // name and gender. Phone/email are not editable here.
      const updated = await api.patch<ApiClientProfile>("/me", {
        name: joinedName,
        gender: gender || null,
      });
      setGender(updated.gender ?? "");
      // The top bar and the account header read the same row; show them the edit.
      await refreshAppUser();
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

  return (
    <div>
      <AccountPageHeader
        title="Profile & security"
        description="Keep your details current so the studio can reach you."
      />

      <div className="max-w-3xl space-y-5">
        {/* Name + contact */}
        <form onSubmit={handleSave} aria-busy={loading}>
          <section className={cardClass} aria-labelledby="personal-info-heading">
            <h2 id="personal-info-heading" className="text-base font-bold text-ink">Personal info</h2>
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
                <label htmlFor="gender" className={labelClass}>
                  Gender
                </label>
                <select
                  id="gender"
                  value={gender}
                  onChange={(e) => setGender(e.target.value as Gender | "")}
                  disabled={loading}
                  className={inputClass}
                >
                  <option value="">Not set</option>
                  {GENDERS.map((g) => (
                    <option key={g.value} value={g.value}>
                      {g.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-5 border-t border-ink/5">
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
            <p className="-mt-2 text-xs text-muted">
              Email and phone can&apos;t be changed here. Contact the studio if
              you need to update them.
            </p>

            <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-3 sm:items-center pt-1">
              <span role="status" className="text-sm font-medium sm:mr-2 empty:hidden">
                {error ? (
                  <span className="text-error">{error}</span>
                ) : saved ? (
                  <span className="text-sage">Changes saved</span>
                ) : null}
              </span>
              <button
                type="submit"
                disabled={saving || loading}
                className="min-h-[48px] w-full sm:w-auto rounded-full bg-ink text-paper px-6 text-sm font-semibold hover:bg-ink/90 transition-colors disabled:opacity-60"
              >
                {saving ? "Saving…" : loading ? "Loading…" : "Save changes"}
              </button>
            </div>
          </section>
        </form>

        {/* Saved cards (#185) — account admin, beside the password, rather than
            on the overview, which is for things waiting on the member. */}
        <SavedCardsCard />

        <ChangePasswordCard />
      </div>
    </div>
  );
}
