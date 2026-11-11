"use client";
// The frame every timetable entry's page is drawn in — a class, a private
// session, a workshop, a corporate session — on the Admin's Schedule and the
// Instructor's alike, so the two show one page with different actions on it.

import Link from "next/link";
import { ArrowLeft, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui";
import type { ClassDifficulty } from "@/lib/schedule";
import type { EventState } from "@/types";

/** Where the page's back link goes: the timetable it was opened from. */
export interface DetailBack {
  href: string;
  label: string;
}

const DIFFICULTY_LABEL: Record<ClassDifficulty, string> = {
  general: "All levels",
  beginner: "Beginner",
  intermediate: "Intermediate",
  advanced: "Advanced",
};

export function DifficultyBadge({ difficulty }: { difficulty: ClassDifficulty }) {
  return (
    <Badge tone={difficulty === "general" ? "neutral" : "accent"}>{DIFFICULTY_LABEL[difficulty]}</Badge>
  );
}

export function DetailFrame({ back, children }: { back: DetailBack; children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-5xl">
      <Link
        href={back.href}
        className="mb-2 inline-flex min-h-10 items-center gap-1 text-sm text-muted hover:text-ink sm:min-h-0"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> {back.label}
      </Link>
      {children}
    </div>
  );
}

export function DetailHeader({
  badge,
  state,
  title,
  meta,
  action,
}: {
  badge: React.ReactNode;
  state: EventState;
  title: string;
  meta: string[];
  action?: React.ReactNode;
}) {
  return (
    <header className="mb-5 border-b border-border pb-5 sm:mb-6 sm:pb-6">
      {/* Wraps so a workshop's two actions drop under the badges on a phone
          instead of pushing the row off-screen. */}
      <div className="mb-2 flex flex-wrap items-center gap-2">
        {badge}
        <StateBadge state={state} />
        {action && <div className="ml-auto">{action}</div>}
      </div>
      <h1 className="break-words text-xl font-semibold text-ink sm:text-2xl">{title}</h1>
      {meta.length > 0 && <p className="mt-1 text-sm text-muted">{meta.join(" · ")}</p>}
    </header>
  );
}

/** The Details card: a grid of read-only label/value pairs. */
export function DetailSection({ children }: { children: React.ReactNode }) {
  return (
    <section className="mb-6 rounded-xl border border-border bg-card p-4 shadow-soft sm:p-5">
      <h2 className="mb-4 text-sm font-semibold text-ink">Details</h2>
      <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">{children}</dl>
    </section>
  );
}

// Read-only label/value pair for the Details section. Pass `children` for a
// non-text value (e.g. a Badge); otherwise pass `value`.
export function DetailField({
  label,
  value,
  sub,
  children,
}: {
  label: string;
  value?: string;
  sub?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-medium uppercase tracking-wide text-muted">{label}</dt>
      <dd className="mt-1 text-sm text-ink">{children ?? value}</dd>
      {sub && <dd className="mt-0.5 text-xs text-muted">{sub}</dd>}
    </div>
  );
}

export function LoadingDetail({ back, label }: { back: DetailBack; label: string }) {
  return (
    <DetailFrame back={back}>
      <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading {label}…
      </div>
    </DetailFrame>
  );
}

export function ErrorDetail({ back, kind, message }: { back: DetailBack; kind: string; message: string }) {
  return (
    <DetailFrame back={back}>
      <header className="mb-5 border-b border-border pb-5 sm:mb-6 sm:pb-6">
        <div className="mb-2 flex items-center gap-2">
          <Badge tone="neutral">{kind}</Badge>
        </div>
        <h1 className="text-xl font-semibold text-ink sm:text-2xl">Couldn’t load detail</h1>
      </header>
      <div className="rounded-xl border border-error/30 bg-error/5 p-6 text-center text-sm text-error">
        {message}
      </div>
    </DetailFrame>
  );
}

export function StateBadge({ state }: { state: EventState }) {
  if (state === "scheduled") return <Badge tone="accent">Scheduled</Badge>;
  if (state === "ongoing") return <Badge tone="warning">Ongoing</Badge>;
  if (state === "completed") return <Badge tone="sage">Completed</Badge>;
  return <Badge tone="error">Cancelled</Badge>;
}
