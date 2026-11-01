"use client";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { AlertTriangle, Check, ChevronDown, ChevronUp, Copy, ExternalLink, PartyPopper } from "lucide-react";
import { toast } from "sonner";
import { Badge, Button, LoadFailure, Select } from "@/components/ui";
import { ApiError, type Api } from "@/lib/api";
import { answeredElsewhere } from "@/lib/failed-read";
import { formatDateTime } from "@/lib/formatters";
import { useStudioZone } from "@/components/brand/brand-provider";
import {
  CLASSPASS_SENDER,
  gmailConfirmationHref,
  mappableLocations,
  setupGuide,
  type ClassPassStatus,
  type SetupStepKey,
} from "@/lib/classpass";
import {
  listClassPassReview,
  mapClassPassReviewLocation,
  mappedSummary,
  unmappedLocations,
  type ClassPassReviewItem,
} from "@/lib/classpass-review";

const TITLES: Record<SetupStepKey, string> = {
  enable: "Turn on ClassPass and copy your address",
  forwarding: "Add the address to Gmail",
  filter: "Confirm it and filter ClassPass emails",
  locations: "Match your location names",
  test_booking: "Test a real booking",
};

/**
 * The ClassPass setup guide: five steps as an accordion, each ticked by a fact
 * the backend works out (`status.setup`), so a step ticks itself once it has
 * happened. Only the first step not done is open; any other opens on click.
 * With every step done it folds into an "All set" banner.
 */
export function ClassPassSetupGuide({
  api,
  status,
  locations,
  busy,
  onEnable,
  onCopy,
  onMapped,
  reviewRevision,
}: {
  api: Api;
  status: ClassPassStatus;
  locations: { id: string; name: string; archivedAt: string | null }[];
  busy: boolean;
  onEnable: () => void;
  onCopy: (text: string, what: string) => void;
  /** A location was mapped from here: the page's mappings, review list and status are stale. */
  onMapped: () => void;
  /** Bumped by the page when the review list may have changed. */
  reviewRevision: number;
}) {
  const timezone = useStudioZone();
  const guide = setupGuide(status.setup);
  const current = guide.steps.find((s) => s.state === "current")?.key ?? null;
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<SetupStepKey | null>(current);
  const [shownCurrent, setShownCurrent] = useState(current);

  // A step ticking itself moves the open panel on to the next one.
  if (current !== shownCurrent) {
    setShownCurrent(current);
    setExpanded(current);
  }

  if (guide.complete && !open) {
    return (
      <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-sage/40 bg-sage/10 p-4 shadow-soft sm:px-6">
        <div className="flex items-center gap-2 text-sm text-ink">
          <PartyPopper className="h-4 w-4 text-sage" />
          <span>
            <strong>All set.</strong> ClassPass bookings are arriving on your rosters.
          </span>
        </div>
        <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
          <ChevronDown className="h-4 w-4" /> Show setup guide
        </Button>
      </section>
    );
  }

  const done = guide.steps.filter((s) => s.done).length;
  const address = status.address;
  const confirmHref = gmailConfirmationHref(status.gmail_confirmation_link);

  const body: Record<SetupStepKey, ReactNode> = {
    enable: (
      <>
        <p>You’ll paste this address into Gmail next.</p>
        <div className="flex flex-wrap items-center gap-2">
          {!status.enabled && (
            <Button size="sm" disabled={busy} onClick={onEnable}>
              Turn on ClassPass
            </Button>
          )}
          {address ? (
            <>
              <code className="min-w-0 break-all rounded-md border border-border bg-paper px-2 py-1 text-xs text-ink">{address}</code>
              <Button size="sm" variant="ghost" onClick={() => onCopy(address, "Address copied.")}>
                <Copy className="h-4 w-4" /> Copy address
              </Button>
            </>
          ) : (
            <span className="text-xs text-muted">Your address isn’t ready yet. Check back shortly.</span>
          )}
        </div>
      </>
    ),
    forwarding: (
      <>
        <ol className="list-[lower-alpha] space-y-1 pl-5">
          <li>
            In the Gmail account ClassPass emails, open{" "}
            <strong>Settings → See all settings → Forwarding and POP/IMAP</strong>.
          </li>
          <li>
            Click <strong>Add a forwarding address</strong>, paste your address, then <strong>Next → Proceed</strong>.
          </li>
        </ol>
        <p className="text-xs text-muted">
          {status.gmail_confirmation_at
            ? `Gmail’s confirmation arrived ${formatDateTime(timezone, status.gmail_confirmation_at)}.`
            : "Waiting for Gmail’s confirmation…"}
        </p>
      </>
    ),
    filter: (
      <>
        <ol className="list-[lower-alpha] space-y-2 pl-5">
          <li>
            {confirmHref ? (
              <>
                Confirm forwarding, in the browser signed in to the studio’s Gmail:
                <a
                  href={confirmHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-1 flex h-9 w-fit items-center gap-2 rounded-lg bg-accent px-3 text-sm font-medium text-white hover:bg-accent-deep sm:h-8"
                >
                  <ExternalLink className="h-4 w-4" /> Confirm forwarding in Gmail
                </a>
              </>
            ) : (
              <>
                Under <strong>Forwarding and POP/IMAP</strong>, enter Gmail’s code and click <strong>Verify</strong>.
              </>
            )}
            {status.gmail_confirmation_code && (
              <span className="mt-1 flex flex-wrap items-center gap-2">
                <code className="rounded-md border border-border bg-paper px-2 py-1 font-mono text-base font-semibold tracking-wider">
                  {status.gmail_confirmation_code}
                </code>
                <Button size="sm" variant="ghost" onClick={() => onCopy(status.gmail_confirmation_code!, "Code copied.")}>
                  <Copy className="h-4 w-4" /> Copy code
                </Button>
              </span>
            )}
          </li>
          <li>
            In Gmail’s search bar, open <strong>Show search options</strong>. In <strong>From</strong>, enter{" "}
            <code className="rounded bg-paper px-1">{CLASSPASS_SENDER}</code>
            <Button size="sm" variant="ghost" className="ml-1 h-7 px-2" onClick={() => onCopy(CLASSPASS_SENDER, "Sender copied.")}>
              <Copy className="h-3.5 w-3.5" />
              <span className="sr-only">Copy the ClassPass sender</span>
            </Button>
            then click <strong>Create filter</strong>.
          </li>
          <li>
            Tick <strong>Forward it to</strong>, pick your address, and click <strong>Create filter</strong>.
          </li>
        </ol>
        <div role="note" className="flex gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
          <p>
            Leave <strong>Disable forwarding</strong> selected, or Gmail sends <strong>all</strong> your email here.
          </p>
        </div>
        <p className="text-xs text-muted">Ticks when ClassPass’s first email arrives, within a day.</p>
      </>
    ),
    locations: (
      <>
        <p>Match each ClassPass location name to one of yours, so its bookings land on the right class.</p>
        <UnmappedLocations api={api} locations={locations} busy={busy} onMapped={onMapped} revision={reviewRevision} />
        <p className="text-xs text-muted">
          {status.setup.location_mappings === 0 ? "None matched yet. " : `${status.setup.location_mappings} matched. `}
          Manage them under{" "}
          <a href="#classpass-locations" className="text-accent underline">
            ClassPass locations
          </a>
          .
        </p>
      </>
    ),
    test_booking: (
      <>
        <ol className="list-[lower-alpha] space-y-1 pl-5">
          <li>Book one of your classes with your own ClassPass account.</li>
          <li>
            Within minutes, you’re on that class’s roster here with a <Badge tone="cyan">ClassPass</Badge> badge.
          </li>
          <li>Cancel it on ClassPass, and you drop off the roster.</li>
        </ol>
        <p className="text-xs text-muted">
          Not there?{" "}
          <a href="#classpass-review" className="text-accent underline">
            For review
          </a>{" "}
          says why.
        </p>
      </>
    ),
  };

  return (
    <section className="rounded-xl border border-border bg-card p-4 shadow-soft sm:p-6">
      <header className="mb-2 flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold text-ink">Set up ClassPass</h2>
          <div className="mt-2 flex items-center gap-3">
            <div
              role="progressbar"
              aria-label="Setup progress"
              aria-valuemin={0}
              aria-valuemax={guide.steps.length}
              aria-valuenow={done}
              className="h-1.5 w-full max-w-48 overflow-hidden rounded-full bg-border"
            >
              <div
                className="h-full rounded-full bg-sage transition-[width] motion-reduce:transition-none"
                style={{ width: `${(done / guide.steps.length) * 100}%` }}
              />
            </div>
            <span className="shrink-0 text-xs text-muted">
              {done} of {guide.steps.length} done
            </span>
          </div>
        </div>
        {guide.complete && (
          <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
            <ChevronUp className="h-4 w-4" /> Hide
          </Button>
        )}
      </header>
      <ol className="divide-y divide-border">
        {guide.steps.map((step, i) => {
          const isOpen = expanded === step.key;
          const panelId = `classpass-step-${step.key}`;
          return (
            <li key={step.key} aria-current={step.state === "current" ? "step" : undefined}>
              <h3>
                <button
                  type="button"
                  aria-expanded={isOpen}
                  aria-controls={panelId}
                  onClick={() => setExpanded(isOpen ? null : step.key)}
                  className="flex w-full items-center gap-3 rounded-md py-3 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                  <span
                    aria-hidden
                    className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                      step.done
                        ? "bg-sage text-white"
                        : step.state === "current"
                          ? "bg-accent text-white"
                          : "border border-border text-muted"
                    }`}
                  >
                    {step.done ? <Check className="h-3.5 w-3.5" /> : i + 1}
                  </span>
                  <span className={`min-w-0 flex-1 font-medium ${step.state === "current" ? "text-ink" : "text-muted"}`}>
                    {TITLES[step.key]}
                    <span className="sr-only">{step.done ? " (done)" : step.state === "current" ? " (current step)" : ""}</span>
                  </span>
                  <ChevronDown
                    aria-hidden
                    className={`h-4 w-4 shrink-0 text-muted transition-transform motion-reduce:transition-none ${
                      isOpen ? "rotate-180" : ""
                    }`}
                  />
                </button>
              </h3>
              {isOpen && (
                <div id={panelId} className="space-y-2 pb-4 pl-9 text-sm text-ink">
                  {body[step.key]}
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/** The ClassPass location names waiting in review, each with the review list's own mapping action. */
function UnmappedLocations({
  api,
  locations,
  busy,
  onMapped,
  revision,
}: {
  api: Api;
  locations: { id: string; name: string; archivedAt: string | null }[];
  busy: boolean;
  onMapped: () => void;
  revision: number;
}) {
  const [items, setItems] = useState<ClassPassReviewItem[] | null>(null);
  const [choice, setChoice] = useState<Record<string, string>>({});
  const [mapping, setMapping] = useState(false);
  // The review list could not be read: the step says so instead of vanishing as if nothing waited.
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const options = useMemo(() => mappableLocations(locations), [locations]);

  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    listClassPassReview(api).then(
      (rows) => {
        if (!cancelled) setItems(rows);
      },
      (err: unknown) => {
        if (!cancelled && !answeredElsewhere(err)) setFailed(true);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [api, revision, attempt]);

  const names = items ? unmappedLocations(items) : [];
  // A failed read says so; after a failed re-read the items from the last good
  // read stay beneath it, and are not drawn as the whole list.
  const failure = failed ? (
    <LoadFailure
      what="the ClassPass locations waiting in review"
      variant="inline"
      detail={items ? "Showing what loaded earlier." : undefined}
      onRetry={() => setAttempt((n) => n + 1)}
    />
  ) : null;
  if (names.length === 0) return failure;

  async function map(itemId: string, locationId: string) {
    setMapping(true);
    try {
      const result = await mapClassPassReviewLocation(api, itemId, locationId);
      toast.success(mappedSummary(result.items));
      onMapped();
    } catch (err) {
      toast.error(err instanceof ApiError ? `That didn’t work (HTTP ${err.status}).` : "That didn’t work.");
    } finally {
      setMapping(false);
    }
  }

  return (
    <div className="space-y-2">
      {failure}
    <ul className="space-y-2">
      {names.map((n) => (
        <li key={n.itemId} className="flex flex-col gap-2 rounded-md border border-border bg-paper p-2 sm:flex-row sm:items-center">
          <span className="min-w-0 flex-1 break-words">
            <strong>{n.name}</strong>
            <span className="ml-1 text-xs text-muted">
              {n.count === 1 ? "1 booking waiting" : `${n.count} bookings waiting`}
            </span>
          </span>
          <Select
            aria-label={`Location for ${n.name}`}
            value={choice[n.itemId] ?? ""}
            disabled={busy || mapping}
            onChange={(e) => setChoice((c) => ({ ...c, [n.itemId]: e.target.value }))}
            className="sm:w-56"
          >
            <option value="">Map this location to…</option>
            {options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </Select>
          <Button
            size="sm"
            variant="secondary"
            disabled={busy || mapping || !choice[n.itemId]}
            onClick={() => void map(n.itemId, choice[n.itemId]!)}
          >
            Map location
          </Button>
        </li>
      ))}
    </ul>
    </div>
  );
}
