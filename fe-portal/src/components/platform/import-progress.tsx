"use client";
import type { ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Upload, X } from "lucide-react";
import { Button } from "@/components/ui";
import type { ImportJob, ImportPhase } from "@/lib/platform";

/** What each phase is doing, in the operator's words. */
const PHASE_LABELS: Record<ImportPhase, string> = {
  uploading: "Receiving the file",
  unpacking: "Reading the archive",
  checking: "Checking the studio is empty",
  accounts: "Creating sign-in accounts",
  writing: "Writing the studio’s records",
  linking: "Linking records together",
  settings: "Restoring branding and settings",
  committing: "Saving",
  finishing: "Opening the studio",
  done: "Done",
};

/** The tables worth naming in a summary, and what to call them. */
const SUMMARY_TABLES: [table: string, label: string][] = [
  ["clients", "members"],
  ["staff_users", "staff"],
  ["class_sessions", "classes"],
  ["bookings", "bookings"],
  ["purchases", "purchases"],
  ["client_packages", "member packages"],
];

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

/**
 * A determinate bar when `value`/`max` are known, and an indeterminate one
 * (no `aria-valuenow`, per the ARIA spec) while the step count is not yet known.
 */
export function ProgressBar({
  label,
  value,
  max,
  valueText,
}: {
  label: string;
  value: number | null;
  max: number | null;
  valueText?: string;
}) {
  const known = value !== null && max !== null && max > 0;
  const percent = known ? Math.min(100, Math.max(0, Math.round((value / max) * 100))) : null;
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent ?? undefined}
      aria-valuetext={valueText ?? (percent !== null ? `${percent}%` : undefined)}
      className="relative h-2 w-full overflow-hidden rounded-full bg-warm"
    >
      {percent !== null ? (
        <div
          className="h-full rounded-full bg-accent transition-[width] duration-300 ease-out"
          style={{ width: `${percent}%` }}
        />
      ) : (
        <div className="h-full w-full animate-pulse rounded-full bg-accent/50 motion-reduce:animate-none" />
      )}
    </div>
  );
}

/**
 * One studio's import, as the row shows it: uploading, processing, finished or
 * failed. Everything but `localUpload` comes from the server's job row, so the
 * same panel appears after a reload, or on another machine.
 */
export function ImportProgress({
  studioName,
  job,
  localUpload,
  onChooseFile,
  onDismiss,
}: {
  studioName: string;
  job: ImportJob | null;
  /** Bytes this page has sent, while it is the one uploading. */
  localUpload: { sent: number; total: number } | null;
  onChooseFile: () => void;
  onDismiss: (job: ImportJob) => void;
}) {
  if (!job && !localUpload) return null;

  // This page is sending the file: the browser's own count is the freshest.
  if (localUpload && (!job || job.status === "uploading")) {
    const { sent, total } = localUpload;
    return (
      <Panel tone="neutral" live>
        <Line>
          <span className="font-medium text-ink">
            Uploading {job?.file_name ?? "archive"} to {studioName}
          </span>
          <span className="tabular-nums text-muted">
            {formatBytes(sent)} of {formatBytes(total)}
          </span>
        </Line>
        <ProgressBar
          label={`Uploading archive to ${studioName}`}
          value={sent}
          max={total}
          valueText={`${formatBytes(sent)} of ${formatBytes(total)} uploaded`}
        />
        <p className="text-xs text-muted">Keep this page open until the upload finishes. After that it runs on its own.</p>
      </Panel>
    );
  }
  if (!job) return null;

  if (job.status === "uploading") {
    // Started from another page — or this page was reloaded mid-upload, in
    // which case the server notices within seconds and this turns into the
    // "interrupted" state below.
    return (
      <Panel tone="neutral" live>
        <Line>
          <span className="font-medium text-ink">Receiving {job.file_name}</span>
          <span className="tabular-nums text-muted">
            {formatBytes(job.received_bytes)} of {formatBytes(job.upload_bytes)}
          </span>
        </Line>
        <ProgressBar
          label={`Receiving archive for ${studioName}`}
          value={job.received_bytes}
          max={job.upload_bytes}
          valueText={`${formatBytes(job.received_bytes)} of ${formatBytes(job.upload_bytes)} received`}
        />
        <p className="text-xs text-muted">Being uploaded from another window.</p>
      </Panel>
    );
  }

  if (job.status === "processing") {
    const known = job.total !== null && job.total > 0;
    return (
      <Panel tone="neutral" live>
        <Line>
          <span className="font-medium text-ink">
            Importing {job.file_name} · {PHASE_LABELS[job.phase] ?? job.phase}
          </span>
          {known && (
            <span className="tabular-nums text-muted">
              {job.processed.toLocaleString()} of {job.total!.toLocaleString()}
            </span>
          )}
        </Line>
        <ProgressBar
          label={`Importing archive into ${studioName}`}
          value={known ? job.processed : null}
          max={known ? job.total : null}
          valueText={
            known
              ? `${PHASE_LABELS[job.phase] ?? job.phase}: ${job.processed.toLocaleString()} of ${job.total!.toLocaleString()} steps`
              : PHASE_LABELS[job.phase] ?? job.phase
          }
        />
        <p className="text-xs text-muted">Runs on the server — safe to close or reload this page.</p>
      </Panel>
    );
  }

  if (job.status === "succeeded" && job.summary) {
    const s = job.summary;
    const counts = SUMMARY_TABLES.map(([table, label]) => [label, s.tables[table] ?? 0] as const).filter(
      ([, n]) => n > 0,
    );
    return (
      <Panel tone="success">
        <Line>
          <span className="flex items-center gap-1.5 font-medium text-ink">
            <CheckCircle2 className="h-4 w-4 text-sage" aria-hidden />
            {s.remapped ? "Copied" : "Restored"} {s.imported.toLocaleString()} records from {s.from.name}
          </span>
          <DismissButton onClick={() => onDismiss(job)} />
        </Line>
        {counts.length > 0 && (
          <p className="text-sm text-muted">
            {counts.map(([label, n]) => `${n.toLocaleString()} ${label}`).join(" · ")}
          </p>
        )}
        <p className="text-xs text-muted">
          {s.remapped ? `${s.from.name} is untouched. ` : ""}
          {s.opened ? `${studioName} is now open.` : ""}
          {job.finished_at ? ` Finished ${new Date(job.finished_at).toLocaleString()}.` : ""}
        </p>
      </Panel>
    );
  }

  // Failed.
  const interrupted = job.error_code === "upload_interrupted";
  return (
    <Panel tone="error">
      <Line>
        <span className="flex items-center gap-1.5 font-medium text-error">
          <AlertTriangle className="h-4 w-4" aria-hidden />
          {interrupted ? "Upload interrupted — choose the file again" : `Import of ${job.file_name} failed`}
        </span>
        <DismissButton onClick={() => onDismiss(job)} />
      </Line>
      {job.error && <p className="text-sm text-ink">{job.error}</p>}
      <div>
        <Button size="sm" variant="secondary" onClick={onChooseFile}>
          <Upload className="h-4 w-4" />
          Choose file
        </Button>
      </div>
    </Panel>
  );
}

function Panel({
  tone,
  live,
  children,
}: {
  tone: "neutral" | "success" | "error";
  live?: boolean;
  children: ReactNode;
}) {
  const border = tone === "error" ? "border-error/40" : tone === "success" ? "border-sage/40" : "border-border";
  return (
    <div
      className={`mt-3 flex flex-col gap-2 rounded-md border ${border} bg-paper p-3`}
      // Finished and failed states are announced once; progress is not read out
      // on every tick — the bar carries it for anyone who asks.
      role={live ? undefined : "status"}
    >
      {children}
    </div>
  );
}

function Line({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-sm">{children}</div>;
}

function DismissButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Dismiss"
      className="rounded p-1 text-muted hover:bg-warm hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
    >
      <X className="h-4 w-4" />
    </button>
  );
}
