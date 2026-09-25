"use client";
/**
 * Change password, on the member's profile (#173): the current password and a
 * new one, through the client pool's own `/change-password`. Other devices stay
 * signed in; "sign out everywhere" is the studio's to do.
 */
import { useState } from "react";
import { memberAuthMessage } from "@/lib/auth-messages";
import { memberAuth } from "@/lib/member-auth";
import { MIN_PASSWORD_LENGTH } from "@/lib/password";

const inputClass =
  "min-h-[44px] rounded-xl border border-ink/10 bg-card px-4 py-2.5 text-sm w-full focus:border-accent focus:ring-2 focus:ring-accent/15 focus:outline-none transition-shadow";
const labelClass = "text-sm font-semibold text-ink mb-1.5 block";
const cardClass = "rounded-2xl bg-card border border-ink/5 shadow-soft p-5 sm:p-6 space-y-5";
const MIN_LENGTH = MIN_PASSWORD_LENGTH;

export function ChangePasswordCard() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaved(false);
    if (next.length < MIN_LENGTH) {
      setError(`Use at least ${MIN_LENGTH} characters.`);
      return;
    }
    if (next !== confirm) {
      setError("The two new passwords don't match.");
      return;
    }
    setError(null);
    setSaving(true);
    try {
      const { error: changeErr } = await memberAuth.changePassword({
        currentPassword: current,
        newPassword: next,
      });
      if (changeErr) {
        setError(memberAuthMessage(changeErr, "Couldn't change your password. Please try again."));
        return;
      }
      setCurrent("");
      setNext("");
      setConfirm("");
      setSaved(true);
    } catch {
      setError("We couldn't reach the server. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <section className={cardClass} aria-labelledby="password-heading">
        <div>
          <h2 id="password-heading" className="text-base font-bold text-ink">Password</h2>
          <p className="mt-0.5 text-sm text-muted">Your other devices stay signed in.</p>
        </div>
        <div>
          <label htmlFor="currentPassword" className={labelClass}>Current password</label>
          <input id="currentPassword" type="password" autoComplete="current-password"
            className={inputClass} value={current} onChange={(ev) => setCurrent(ev.target.value)} />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label htmlFor="newPassword" className={labelClass}>New password</label>
            <input id="newPassword" type="password" autoComplete="new-password"
              className={inputClass} value={next} onChange={(ev) => setNext(ev.target.value)} />
          </div>
          <div>
            <label htmlFor="confirmPassword" className={labelClass}>Confirm new password</label>
            <input id="confirmPassword" type="password" autoComplete="new-password"
              className={inputClass} value={confirm} onChange={(ev) => setConfirm(ev.target.value)} />
          </div>
        </div>
        <p className="-mt-2 text-xs text-muted">At least {MIN_LENGTH} characters.</p>
        <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-3 sm:items-center pt-1">
          <span role="status" className="text-sm font-medium sm:mr-2 empty:hidden">
            {error ? (
              <span className="text-error">{error}</span>
            ) : saved ? (
              <span className="text-sage">Password changed</span>
            ) : null}
          </span>
          <button
            type="submit"
            disabled={saving || !current || !next}
            className="min-h-[48px] w-full sm:w-auto rounded-full bg-ink text-paper px-6 text-sm font-semibold hover:bg-ink/90 transition-colors disabled:opacity-60"
          >
            {saving ? "Saving…" : "Change password"}
          </button>
        </div>
      </section>
    </form>
  );
}
