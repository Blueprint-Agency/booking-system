"use client";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { AlertTriangle, Check, ChevronDown, ChevronUp, Copy, ExternalLink, PartyPopper } from "lucide-react";
import { toast } from "sonner";
import { Badge, Button, Select } from "@/components/ui";
import { ApiError, type Api } from "@/lib/api";
import { formatDateTime } from "@/lib/formatters";
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
  forwarding: "Add your address as a forwarding address in Gmail",
  filter: "Confirm the address and forward only ClassPass’s emails",
  locations: "Match your ClassPass location names",
  test_booking: "Test it with a real booking",
};

/**
 * The ClassPass setup guide: five numbered steps, each ticked by a fact the
 * backend works out (`status.setup`), so a step ticks itself once it has
 * happened. The first step not done is highlighted; the rest stay readable.
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
  const guide = setupGuide(status.setup);
  const [open, setOpen] = useState(false);

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
        <p>Switch on <strong>Import ClassPass bookings</strong>, then copy your ClassPass address. You’ll paste it into Gmail next.</p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
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
            <span className="text-xs text-muted">Your ClassPass address isn’t available yet. Please check back later.</span>
          )}
        </div>
      </>
    ),
    forwarding: (
      <>
        <p>
          Open Gmail on your computer, signed in to the account ClassPass emails your studio at. Click the{" "}
          <strong>gear icon → See all settings → Forwarding and POP/IMAP</strong>, then{" "}
          <strong>Add a forwarding address</strong>. Paste your ClassPass address and click <strong>Next → Proceed</strong>.
        </p>
        <p className="mt-1 text-muted">
          Gmail then emails that address to confirm. Its confirmation shows up here by itself.
        </p>
        <div className="mt-2 space-y-2 rounded-md border border-border bg-paper px-3 py-2">
          {confirmHref && (
            <div>
              <a
                href={confirmHref}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex h-9 items-center gap-2 rounded-lg bg-accent px-3 text-sm font-medium text-white hover:bg-accent-deep sm:h-8"
              >
                <ExternalLink className="h-4 w-4" /> Confirm forwarding in Gmail
              </a>
              <p className="mt-1 text-xs text-muted">
                Opens Gmail’s confirmation in a new tab. Open it in the browser where you’re signed in to your studio’s Gmail,
                or Gmail can’t confirm it.
              </p>
            </div>
          )}
          {status.gmail_confirmation_code && (
            <div className="flex flex-wrap items-center gap-3">
              <div>
                <span className="text-xs text-muted">Confirmation code</span>
                <div className="font-mono text-lg font-semibold tracking-wider text-ink">{status.gmail_confirmation_code}</div>
              </div>
              <Button size="sm" variant="ghost" onClick={() => onCopy(status.gmail_confirmation_code!, "Code copied.")}>
                <Copy className="h-4 w-4" /> Copy code
              </Button>
            </div>
          )}
          {status.gmail_confirmation_at ? (
            <span className="block text-xs text-muted">Received {formatDateTime(status.gmail_confirmation_at)}</span>
          ) : (
            <span className="text-xs text-muted">Waiting for Gmail’s confirmation…</span>
          )}
        </div>
      </>
    ),
    filter: (
      <>
        <ol className="list-[lower-alpha] space-y-1 pl-5">
          <li>
            Confirm the address: click <strong>Confirm forwarding in Gmail</strong> above or, if Gmail sent a code, paste it
            on <strong>Forwarding and POP/IMAP</strong> and click <strong>Verify</strong>.
          </li>
          <li>
            In Gmail’s search bar, click the <strong>filter icon</strong> (Show search options). In <strong>From</strong>, enter{" "}
            <code className="rounded bg-paper px-1">{CLASSPASS_SENDER}</code>
            <Button size="sm" variant="ghost" className="ml-1 h-7 px-2" onClick={() => onCopy(CLASSPASS_SENDER, "Sender copied.")}>
              <Copy className="h-3.5 w-3.5" />
              <span className="sr-only">Copy the ClassPass sender</span>
            </Button>
            and click <strong>Create filter</strong>.
          </li>
          <li>
            Tick <strong>Forward it to</strong>, choose your ClassPass address, and click <strong>Create filter</strong>.
          </li>
        </ol>
        <div role="note" className="mt-2 flex gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
          <p>
            On the Forwarding page, keep <strong>Disable forwarding</strong> selected. Choosing “Forward a copy of incoming mail”
            sends <strong>all</strong> your email here. Only ClassPass’s emails should go through, by the filter.
          </p>
        </div>
        <p className="mt-2 text-muted">
          This ticks when the first email from ClassPass arrives. ClassPass sends its Daily Roster every day, so it can take up
          to a day.
        </p>
      </>
    ),
    locations: (
      <>
        <p>
          ClassPass names your locations in its own words. Match each name to one of your Locations, so its bookings land on the
          right class.
        </p>
        <UnmappedLocations api={api} locations={locations} busy={busy} onMapped={onMapped} revision={reviewRevision} />
        <p className="mt-2 text-muted">
          {status.setup.location_mappings === 0
            ? "No location is matched yet. "
            : `${status.setup.location_mappings} matched so far. `}
          You can also add them under{" "}
          <a href="#classpass-locations" className="text-accent underline">
            ClassPass locations
          </a>{" "}
          below.
        </p>
      </>
    ),
    test_booking: (
      <>
        <ol className="list-[lower-alpha] space-y-1 pl-5">
          <li>Book one of your classes with your own ClassPass account.</li>
          <li>
            Within a few minutes, open that class’s roster here: you should be on it with a <Badge tone="cyan">ClassPass</Badge>{" "}
            badge.
          </li>
          <li>Cancel the booking on ClassPass, and check it disappears from the roster.</li>
        </ol>
        <p className="mt-2 text-muted">
          Not on the roster? Look in{" "}
          <a href="#classpass-review" className="text-accent underline">
            For review
          </a>{" "}
          below: it says why the booking couldn’t be placed.
        </p>
      </>
    ),
  };

  return (
    <section className="rounded-xl border border-border bg-card p-4 shadow-soft sm:p-6">
      <header className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-ink">Set up ClassPass</h2>
          <p className="mt-0.5 text-xs text-muted">
            {guide.complete
              ? "Every step is done."
              : `${done} of ${guide.steps.length} done. Each step ticks itself once it has happened.`}
          </p>
        </div>
        {guide.complete && (
          <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
            <ChevronUp className="h-4 w-4" /> Hide
          </Button>
        )}
      </header>
      <ol className="space-y-3">
        {guide.steps.map((step, i) => (
          <li
            key={step.key}
            aria-current={step.state === "current" ? "step" : undefined}
            className={`flex gap-3 rounded-lg border p-3 ${
              step.state === "current" ? "border-accent bg-accent/5" : "border-border"
            }`}
          >
            <span
              aria-hidden
              className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                step.done
                  ? "bg-sage text-white"
                  : step.state === "current"
                    ? "bg-accent text-white"
                    : "border border-border text-muted"
              }`}
            >
              {step.done ? <Check className="h-3.5 w-3.5" /> : i + 1}
            </span>
            <div className="min-w-0 flex-1 text-sm text-ink">
              <h3 className={`font-medium ${step.done ? "text-muted" : "text-ink"}`}>
                {TITLES[step.key]}
                <span className="sr-only">{step.done ? " (done)" : step.state === "current" ? " (current step)" : ""}</span>
              </h3>
              <div className="mt-1 space-y-1">{body[step.key]}</div>
            </div>
          </li>
        ))}
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
  const options = useMemo(() => mappableLocations(locations), [locations]);

  useEffect(() => {
    let cancelled = false;
    listClassPassReview(api).then(
      (rows) => {
        if (!cancelled) setItems(rows);
      },
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [api, revision]);

  const names = items ? unmappedLocations(items) : [];
  if (names.length === 0) return null;

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
    <ul className="mt-2 space-y-2">
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
  );
}
