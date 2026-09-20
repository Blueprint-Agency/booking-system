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
  "rounded-xl border border-ink/10 bg-paper px-4 py-3 text-sm w-full focus:border-accent focus:outline-none";
const labelClass = "text-xs uppercase tracking-wider text-muted mb-2 block";
const cardClass = "rounded-2xl bg-paper border border-ink/10 p-8 space-y-6";
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
      <section className={cardClass}>
        <h3 className="font-serif text-lg text-ink">Password</h3>
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
        <p className="text-xs text-muted">At least {MIN_LENGTH} characters.</p>
        <div className="flex flex-wrap justify-end gap-3 items-center pt-2">
          {error && <span className="text-sm text-error font-medium mr-2">{error}</span>}
          {saved && <span className="text-sm text-sage font-medium mr-2">Password changed</span>}
          <button
            type="submit"
            disabled={saving || !current || !next}
            className="rounded-full bg-ink text-paper px-5 py-3 text-sm font-medium disabled:opacity-60"
          >
            {saving ? "Saving…" : "Change password"}
          </button>
        </div>
      </section>
    </form>
  );
}
