"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Badge, Button, Select } from "@/components/ui";
import { ApiError, type Api } from "@/lib/api";
import { ERROR_CODES } from "@/lib/error-codes";
import { formatDateTime } from "@/lib/formatters";
import { mappableLocations } from "@/lib/classpass";
import { reviewParam, withoutParams } from "@/lib/attention";
import {
  bookClassPassReviewItem,
  canBook,
  dismissClassPassReviewItem,
  listClassesNear,
  listClassPassReview,
  mapClassPassReviewLocation,
  mappedSummary,
  reviewReasonLabel,
  type ClassPassReviewItem,
} from "@/lib/classpass-review";
import type { ApiScheduleEntry } from "@/lib/use-schedule";

function refusal(err: unknown): string {
  const code = err instanceof ApiError ? (err.body as { error?: string } | null)?.error : undefined;
  switch (code) {
    case ERROR_CODES.classpass_reservation_taken:
      return "This reservation is already booked.";
    case ERROR_CODES.already_booked:
      return "The member is already on that class.";
    case ERROR_CODES.classpass_client_deleted:
      return "This member was removed from the studio, so they can’t be booked.";
    case ERROR_CODES.classpass_review_resolved:
      return "Someone has already dealt with this one.";
    case ERROR_CODES.classpass_review_incomplete:
      return "The email didn’t say enough to book it. Dismiss it instead.";
    case ERROR_CODES.classpass_review_not_booking:
      return "This is a cancellation, not a booking. Cancel the booking on its class, then dismiss this.";
    case ERROR_CODES.classpass_review_not_found:
      return "That item no longer exists.";
    case ERROR_CODES.class_not_found:
      return "That class is gone or cancelled. Choose another.";
    case ERROR_CODES.classpass_mapping_exists:
      return "That ClassPass name is already mapped.";
    case ERROR_CODES.location_archived:
      return "That Location is archived. Choose a live one.";
    default:
      return err instanceof ApiError ? `That didn’t work (HTTP ${err.status}).` : "That didn’t work.";
  }
}

/**
 * ClassPass review: every ClassPass email the importer couldn't place
 * (or kept while it was off), until an Admin books it into a class, dismisses
 * it, or (for an unmapped location) maps the location, which imports every open
 * item from it that now matches.
 */
export function ClassPassReview({
  api,
  locations,
  revision,
  onChanged,
}: {
  api: Api;
  locations: { id: string; name: string; archivedAt: string | null }[];
  /** Bumped by the page when something elsewhere on it (a location mapping) may have changed the list. */
  revision: number;
  /** Something was booked, closed or mapped: the page's counts and mappings are stale. */
  onChanged?: () => void;
}) {
  const [items, setItems] = useState<ClassPassReviewItem[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [version, setVersion] = useState(0);
  const load = useCallback(() => setVersion((n) => n + 1), []);
  // The item a bell link (`?review=<id>`) names: scrolled to and opened once the list has loaded.
  // Read once, on arrival. An id that is no longer open (someone dealt with it) matches no item.
  const [wanted] = useState(() => (typeof window === "undefined" ? null : reviewParam(window.location.search)));
  const focusId = wanted && items?.some((i) => i.id === wanted) ? wanted : null;

  useEffect(() => {
    if (!wanted || items === null) return;
    // Drop the param so closing the item and following the same link again opens it again.
    window.history.replaceState(
      window.history.state,
      "",
      `${window.location.pathname}${withoutParams(window.location.search, ["review"])}${window.location.hash}`,
    );
  }, [wanted, items === null]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let cancelled = false;
    listClassPassReview(api).then(
      (rows) => {
        if (cancelled) return;
        setItems(rows);
        setLoadError(null);
      },
      (err) => {
        if (!cancelled) setLoadError(err instanceof ApiError ? `HTTP ${err.status}` : "Network error");
      },
    );
    return () => {
      cancelled = true;
    };
  }, [api, version, revision]);

  async function run<T>(work: () => Promise<T>, done: (result: T) => string): Promise<void> {
    if (busy) return;
    setBusy(true);
    try {
      const result = await work();
      toast.success(done(result));
      onChanged?.();
    } catch (err) {
      toast.error(refusal(err));
    } finally {
      load();
      setBusy(false);
    }
  }

  return (
    <section className="rounded-xl border border-border bg-card p-4 shadow-soft sm:p-6">
      <header className="mb-4">
        <h2 className="text-base font-semibold text-ink">For review</h2>
        <p className="mt-0.5 text-xs text-muted">
          ClassPass bookings that couldn’t be placed on a class. Book each into the class it means, or dismiss it.
        </p>
      </header>

      {loadError ? (
        <div className="text-sm text-error">
          Failed to load: {loadError}{" "}
          <button type="button" className="underline" onClick={load}>
            Retry
          </button>
        </div>
      ) : items === null ? (
        <div className="flex items-center gap-2 text-sm text-muted">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : items.length === 0 ? (
        <p className="text-sm text-muted">Nothing to review.</p>
      ) : (
        <ul className="space-y-3">
          {items.map((item) => (
            <ReviewItem
              key={item.id}
              api={api}
              item={item}
              locations={locations}
              focused={item.id === focusId}
              busy={busy}
              onBook={(classId) => run(() => bookClassPassReviewItem(api, item.id, classId), () => "Booked.")}
              onDismiss={() => run(() => dismissClassPassReviewItem(api, item.id), () => "Dismissed.")}
              onMap={(locationId) =>
                run(() => mapClassPassReviewLocation(api, item.id, locationId), (r) => mappedSummary(r.items))
              }
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function ReviewItem({
  api,
  item,
  locations,
  focused,
  busy,
  onBook,
  onDismiss,
  onMap,
}: {
  api: Api;
  item: ClassPassReviewItem;
  locations: { id: string; name: string; archivedAt: string | null }[];
  /** A bell link named this item: scroll to it and open the email. */
  focused: boolean;
  busy: boolean;
  onBook: (classId: string) => void;
  onDismiss: () => void;
  onMap: (locationId: string) => void;
}) {
  // The email is open for the item a bell link named, until the Admin says otherwise.
  const [chosen, setChosen] = useState<boolean | null>(null);
  const showEmail = chosen ?? focused;
  const rowRef = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (!focused) return;
    rowRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [focused]);
  const [classes, setClasses] = useState<ApiScheduleEntry[] | null>(null);
  const [picking, setPicking] = useState(false);
  const [classId, setClassId] = useState("");
  const [locationId, setLocationId] = useState("");
  const options = useMemo(() => mappableLocations(locations), [locations]);
  const locationName = (id: string | null) => locations.find((l) => l.id === id)?.name;

  async function pickClass() {
    setPicking(true);
    try {
      const found = await listClassesNear(api, item);
      setClasses(found);
      setClassId(found[0]?.id ?? "");
    } catch (err) {
      toast.error(refusal(err));
      setPicking(false);
    }
  }

  const fields: [string, string | null][] = [
    ["Class", item.class_name],
    ["When", item.starts_at ? formatDateTime(item.starts_at) : null],
    ["Location", item.location_name],
    ["Member", item.member_name && item.member_email ? `${item.member_name} · ${item.member_email}` : item.member_email],
    ["Reservation ID", item.reservation_id],
  ];

  return (
    <li
      ref={rowRef}
      id={`classpass-review-${item.id}`}
      className={`rounded-md border p-3 ${focused ? "border-accent" : "border-border"}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={item.reason === "unparsed" || item.reason === "import_error" ? "error" : "warning"}>
          {reviewReasonLabel(item.reason)}
        </Badge>
        {item.kind === "cancellation" && <Badge tone="neutral">Cancellation</Badge>}
        <span className="text-xs text-muted">Received {formatDateTime(item.received_at)}</span>
      </div>
      <dl className="mt-2 grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[8rem_1fr]">
        {fields.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-xs text-muted sm:text-sm">{label}</dt>
            <dd className="break-all text-ink">{value ?? <span className="text-muted">Not read</span>}</dd>
          </div>
        ))}
      </dl>

      <button type="button" className="mt-2 text-xs text-accent underline" onClick={() => setChosen(!showEmail)}>
        {showEmail ? "Hide the email" : "Show the email"}
      </button>
      {showEmail &&
        (item.html ? (
          // The email as it arrived, with its scripts and links disabled.
          <iframe
            title={`ClassPass email received ${formatDateTime(item.received_at)}`}
            sandbox=""
            srcDoc={item.html}
            className="mt-2 h-80 w-full rounded-md border border-border bg-white"
          />
        ) : (
          <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap rounded-md border border-border bg-paper p-2 text-xs">
            {item.text ?? "(empty)"}
          </pre>
        ))}

      {item.reason === "unmapped_location" && item.location_name && (
        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
          <Select
            aria-label={`Location for ${item.location_name}`}
            value={locationId}
            disabled={busy}
            onChange={(e) => setLocationId(e.target.value)}
            className="sm:w-64"
          >
            <option value="">Map this location to…</option>
            {options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </Select>
          <Button size="sm" variant="secondary" disabled={busy || !locationId} onClick={() => onMap(locationId)}>
            Map location
          </Button>
        </div>
      )}

      {picking && (
        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
          {classes === null ? (
            <span className="flex items-center gap-2 text-sm text-muted">
              <Loader2 className="h-4 w-4 animate-spin" /> Finding classes…
            </span>
          ) : classes.length === 0 ? (
            <span className="text-sm text-muted">No classes within a day of this booking.</span>
          ) : (
            <>
              <Select
                aria-label="Class to book into"
                value={classId}
                disabled={busy}
                onChange={(e) => setClassId(e.target.value)}
                className="sm:w-80"
              >
                {classes.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label} · {formatDateTime(c.starts_at)}
                    {locationName(c.location_id) ? ` · ${locationName(c.location_id)}` : ""}
                  </option>
                ))}
              </Select>
              <Button size="sm" disabled={busy || !classId} onClick={() => onBook(classId)}>
                Book
              </Button>
            </>
          )}
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        {canBook(item) && !picking && (
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => void pickClass()}>
            Book into a class
          </Button>
        )}
        <Button size="sm" variant="ghost" disabled={busy} onClick={onDismiss}>
          Dismiss
        </Button>
      </div>
    </li>
  );
}
