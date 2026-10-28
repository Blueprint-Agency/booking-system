"use client";
import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button, PageHeader } from "@/components/ui";
import { ApiError } from "@/lib/api";
import { useWorkspace } from "@/lib/workspace-context";
import { emailGroups, fetchStudioEmails, switchEmail, type StudioEmailsView } from "@/lib/emails";

/**
 * Every email the platform sends for the studio, to members and to staff, each
 * with one switch for the whole studio. A locked email is always sent, so it
 * shows greyed out with its switch disabled. Studio admins only; the backend
 * refuses instructors.
 */
export default function EmailsPage() {
  const { api } = useWorkspace();
  const [view, setView] = useState<StudioEmailsView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<ReadonlySet<string>>(new Set());
  // Bumped by Retry; loading until the attempt asked for has an answer.
  const [attempt, setAttempt] = useState(0);
  const [answered, setAnswered] = useState<number | null>(null);
  const loading = answered !== attempt;

  useEffect(() => {
    if (!api) return;
    let cancelled = false;
    fetchStudioEmails(api).then(
      (next) => {
        if (cancelled) return;
        setView(next);
        setError(null);
        setAnswered(attempt);
      },
      (err) => {
        if (cancelled) return;
        setError(err instanceof ApiError ? `HTTP ${err.status}` : "Network error");
        setAnswered(attempt);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [api, attempt]);

  async function toggle(slug: string, enabled: boolean) {
    if (!api || saving.has(slug)) return;
    setSaving((s) => new Set(s).add(slug));
    const refusal = await switchEmail(api, slug, enabled, (update) =>
      setView((current) => (current ? update(current) : current)),
    );
    setSaving((s) => {
      const next = new Set(s);
      next.delete(slug);
      return next;
    });
    if (refusal) toast.error(refusal);
  }

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center gap-2 text-sm text-muted">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading emails…
      </div>
    );
  }

  if (error || !view) {
    return (
      <div className="mx-auto max-w-3xl rounded-xl border border-error/30 bg-error/5 p-6 text-center">
        <p className="text-sm text-error">Failed to load: {error}</p>
        <Button size="sm" variant="ghost" onClick={() => setAttempt((n) => n + 1)} className="mt-2">
          Retry
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Emails"
        description="The emails your studio sends. Turn one off and it stops going out, for everyone, straight away."
      />

      <div className="space-y-6">
        {emailGroups(view).map((group) => (
          <section key={group.audience} aria-labelledby={`emails-${group.audience}`}>
            <h2 id={`emails-${group.audience}`} className="mb-2 text-base font-semibold text-ink">
              {group.title}
            </h2>
            <ul className="divide-y divide-border rounded-xl border border-border bg-card shadow-soft">
              {group.emails.map((e) => (
                <li
                  key={e.slug}
                  className={`flex items-center justify-between gap-4 px-4 py-3 sm:px-5 ${e.locked ? "opacity-50" : ""}`}
                >
                  <span className="min-w-0 text-sm text-ink">{e.name}</span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={e.enabled}
                    aria-label={e.name}
                    disabled={e.locked || saving.has(e.slug)}
                    onClick={() => toggle(e.slug, !e.enabled)}
                    // The before: box widens the hit area to thumb size without
                    // growing the switch itself.
                    className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors before:absolute before:-inset-2 before:content-[''] disabled:cursor-not-allowed ${
                      e.enabled ? "bg-accent" : "bg-border"
                    }`}
                  >
                    <span
                      className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ${
                        e.enabled ? "translate-x-5" : "translate-x-0.5"
                      }`}
                    />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
