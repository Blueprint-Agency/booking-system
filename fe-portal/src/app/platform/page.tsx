"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CalendarClock,
  CreditCard,
  Download,
  ExternalLink,
  Loader2,
  MoreHorizontal,
  Pause,
  PenLine,
  Play,
  Plus,
  Trash2,
  Upload,
  UserPlus,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import { Button, EmptyState, PageHeader, StatusBadge } from "@/components/ui";
import { CreateTenantDialog } from "@/components/platform/create-tenant-dialog";
import { DeleteTenantDialog } from "@/components/platform/delete-tenant-dialog";
import { InviteFirstAdminDialog } from "@/components/platform/invite-first-admin-dialog";
import { RenameTenantDialog } from "@/components/platform/rename-tenant-dialog";
import { PaymentCredentialsDialog } from "@/components/platform/payment-credentials-dialog";
import { TenantTermDialog } from "@/components/platform/tenant-term-dialog";
import { ImportProgress } from "@/components/platform/import-progress";
import { ApiError, makeApi } from "@/lib/api";
import {
  TENANT_REFUSALS,
  dismissImport,
  exportTenant,
  formatTermDate,
  isImportRunning,
  latestImport,
  listOpenImports,
  listTenants,
  setTenantStatus,
  startImport,
  uploadImportArchive,
  type ImportJob,
  type PlatformTenant,
} from "@/lib/platform";

/** How often a running import is asked for its progress. */
const POLL_MS = 1500;

/** A refusal from the import routes: a sentence, and the job in the way if any. */
type RefusalBody = { message?: string; job?: ImportJob } | null;

/** One line saying how long a studio is paid for, and whether that has run out. */
function termLine(tenant: PlatformTenant): string {
  const from = formatTermDate(tenant.term.start_date);
  if (!tenant.term.end_date) return `Term from ${from} · no end date`;
  const to = formatTermDate(tenant.term.end_date);
  return tenant.term.ended ? `Term ${from} – ${to} · ended` : `Term ${from} – ${to}`;
}
import { getPortalToken, usePortalSession } from "@/lib/portal-auth";

/**
 * Every studio on the platform, and the few things that are done to one from
 * outside it: create, suspend, rename, set its Term, move its data in or out,
 * and — once suspended — delete it.
 *
 * Everything else about a studio is administered from inside the studio, by its
 * own admins. This page stays deliberately thin — a super portal that grew a
 * second copy of the admin console would be a second place for every rule to
 * drift.
 */
export default function PlatformPage() {
  const { isLoaded, session } = usePortalSession();
  const isSignedIn = session !== null;
  const api = useMemo(() => makeApi(getPortalToken), []);

  const [tenants, setTenants] = useState<PlatformTenant[] | null>(null);
  /** Set when the backend says this account may not be here — a 404, because the
   *  super portal does not confirm its own existence to people who cannot use it. */
  const [refused, setRefused] = useState(false);
  const [creating, setCreating] = useState(false);
  /** The studio the invite dialog is open for, or null. */
  const [inviting, setInviting] = useState<PlatformTenant | null>(null);
  /** The studio the rename dialog is open for, or null. */
  const [renaming, setRenaming] = useState<PlatformTenant | null>(null);
  /** The studio whose payment account is being set, or null. */
  const [payingFor, setPayingFor] = useState<PlatformTenant | null>(null);
  /** The studio whose Term is being set, or null. */
  const [termFor, setTermFor] = useState<PlatformTenant | null>(null);
  /** The studio the delete dialog is open for, or null. */
  const [deleting, setDeleting] = useState<PlatformTenant | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  /** One file input serves every row; this is the studio the picker is for. */
  const [importTarget, setImportTarget] = useState<PlatformTenant | null>(null);
  /** Each studio's latest import worth showing, as the server last reported it. */
  const [imports, setImports] = useState<Record<string, ImportJob>>({});
  /** Bytes sent by an upload *this page* is making, per studio. */
  const [uploads, setUploads] = useState<Record<string, { sent: number; total: number }>>({});
  const fileInput = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const { tenants: rows } = await listTenants(api);
      setTenants(rows);
      setRefused(false);
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        setRefused(true);
        setTenants([]);
        return;
      }
      toast.error("Could not load the studio list.");
      setTenants([]);
    }
  }, [api]);

  useEffect(() => {
    if (isLoaded && isSignedIn) void load();
  }, [isLoaded, isSignedIn, load]);

  /**
   * Is a quick action in flight for this studio?
   *
   * One `busyId` serves every row, and the actions tag it differently — the
   * status toggle with the bare id, export with a prefix. A button comparing
   * against only one of those spins while staying clickable. An import is not
   * one of these: it can run for minutes, so it disables only "Restore archive"
   * (see `importBlocked`) and the rest of the menu stays usable.
   */
  function isBusy(id: string) {
    return busyId === id || busyId === `export:${id}`;
  }

  /** Why a new import cannot start for this studio right now, if it cannot. */
  function importBlocked(id: string): string | undefined {
    if (uploads[id]) return "Uploading — wait for it to finish";
    if (isImportRunning(imports[id])) return "An import is running";
    return undefined;
  }

  async function toggleSuspension(tenant: PlatformTenant) {
    const next = tenant.status === "active" ? "suspended" : "active";
    if (
      next === "suspended" &&
      !window.confirm(
        `Suspend ${tenant.name}? Its staff and members will be refused until it is reactivated. No data is deleted.`,
      )
    ) {
      return;
    }

    setBusyId(tenant.id);
    try {
      const { tenant: updated } = await setTenantStatus(api, tenant.id, next);
      setTenants(rows => (rows ?? []).map(row => (row.id === updated.id ? updated : row)));
      toast.success(next === "suspended" ? `${tenant.name} suspended.` : `${tenant.name} reactivated.`);
    } catch (err) {
      // A studio whose Term has ended cannot be reactivated until the Term is
      // extended — say so, rather than a bare failure.
      const code =
        err instanceof ApiError && err.body && typeof err.body === "object"
          ? (err.body as { error?: string }).error
          : undefined;
      toast.error(
        code && TENANT_REFUSALS[code] ? TENANT_REFUSALS[code] : "Could not change the studio's status.",
      );
    } finally {
      setBusyId(null);
    }
  }

  async function downloadArchive(tenant: PlatformTenant) {
    setBusyId(`export:${tenant.id}`);
    try {
      await exportTenant(getPortalToken, tenant);
      toast.success(`${tenant.name} exported.`);
    } catch {
      toast.error(`Could not export ${tenant.name}.`);
    } finally {
      setBusyId(null);
    }
  }

  /** Open the file picker, remembering which studio it is for. */
  function pickArchiveFor(tenant: PlatformTenant) {
    setImportTarget(tenant);
    fileInput.current?.click();
  }

  /** Put one studio's job into the map, replacing whatever it had. */
  const putJob = useCallback((job: ImportJob) => {
    setImports(current => ({ ...current, [job.tenant_id]: job }));
  }, []);

  /**
   * Restore an archive, as a server-side job.
   *
   * Only the upload needs this page: once the file has arrived the server runs
   * the import on its own, and the poll below follows it — from this page load
   * or the next one.
   */
  async function uploadArchive(file: File) {
    const tenant = importTarget;
    if (!tenant) return;
    setImportTarget(null);

    if (
      !window.confirm(
        `Restore ${file.name} into ${tenant.name}? It must have no data of its own yet, and everything in the file is written exactly as it was.`,
      )
    ) {
      return;
    }

    let job: ImportJob;
    try {
      ({ job } = await startImport(api, tenant.id, file));
    } catch (err) {
      // Refused with a sentence — an import already running, a file too big —
      // and the refusal names the running import, so the row can show it.
      const body = err instanceof ApiError && typeof err.body === "object" ? (err.body as RefusalBody) : null;
      if (body?.job) putJob(body.job);
      toast.error(body?.message ?? `Could not start the import into ${tenant.name}.`);
      return;
    }

    putJob(job);
    setUploads(current => ({ ...current, [tenant.id]: { sent: 0, total: file.size } }));
    try {
      const handed = await uploadImportArchive(getPortalToken, tenant.id, job.id, file, (sent, total) =>
        setUploads(current => ({ ...current, [tenant.id]: { sent, total } })),
      );
      putJob(handed);
    } catch (err) {
      const body = err instanceof ApiError && typeof err.body === "object" ? (err.body as RefusalBody) : null;
      if (body?.job) putJob(body.job);
      else {
        // The request never answered: ask the server what it made of it.
        try {
          const { job: latest } = await latestImport(api, tenant.id);
          if (latest) putJob(latest);
        } catch {
          /* the poll will catch up */
        }
      }
      toast.error(body?.message ?? `The upload to ${tenant.name} did not finish. Choose the file again.`);
    } finally {
      setUploads(current => {
        const next = { ...current };
        delete next[tenant.id];
        return next;
      });
    }
  }

  async function dismiss(job: ImportJob) {
    try {
      await dismissImport(api, job.tenant_id, job.id);
    } catch {
      // Hidden either way: a notice that will not close is worse than one that
      // comes back on the next load.
    }
    setImports(current => {
      const next = { ...current };
      if (next[job.tenant_id]?.id === job.id) delete next[job.tenant_id];
      return next;
    });
  }

  // Every studio's open import, once per page load: this is how a reload picks
  // the bar back up. Nothing about it was kept in the browser.
  useEffect(() => {
    if (!isLoaded || !isSignedIn || refused) return;
    let cancelled = false;
    void listOpenImports(api)
      .then(({ imports: jobs }) => {
        if (cancelled) return;
        setImports(Object.fromEntries(jobs.map(job => [job.tenant_id, job])));
      })
      .catch(() => {
        /* the list still works without it; the next action will say */
      });
    return () => {
      cancelled = true;
    };
  }, [api, isLoaded, isSignedIn, refused]);

  // While anything is running, follow it. Only the running studios are asked,
  // so an idle page makes no requests at all.
  const running = Object.values(imports)
    .filter(job => isImportRunning(job))
    .map(job => job.tenant_id)
    .sort()
    .join(",");
  useEffect(() => {
    if (!running) return;
    const ids = running.split(",");
    let inFlight = false;
    const timer = setInterval(async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const answers = await Promise.all(ids.map(id => latestImport(api, id).catch(() => null)));
        let finished = false;
        for (const answer of answers) {
          const job = answer?.job;
          if (!job) continue;
          if (!isImportRunning(job)) finished = true;
          putJob(job);
        }
        // A finished import can have opened the studio; the row's badges read
        // from the list.
        if (finished) void load();
      } finally {
        inFlight = false;
      }
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [running, api, putJob, load]);

  // Leaving mid-upload interrupts it — say so before it happens.
  const uploadingNow = Object.keys(uploads).length > 0;
  useEffect(() => {
    if (!uploadingNow) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [uploadingNow]);

  if (!isLoaded || tenants === null) {
    return (
      <div className="flex items-center gap-2 py-16 text-sm text-muted">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading studios…
      </div>
    );
  }

  if (refused) {
    return (
      <EmptyState
        title="Not available"
        description="This address isn’t available for your account."
      />
    );
  }

  return (
    <>
      <PageHeader
        title="Studios"
        description="Every tenant on the platform. Creating one takes effect immediately — no deployment."
        actions={
          <Button onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" />
            New studio
          </Button>
        }
      />

      {tenants.length === 0 ? (
        <EmptyState
          title="No studios yet"
          description="Create the first one and its URLs will work straight away."
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {tenants.map(tenant => (
            <li
              key={tenant.id}
              className="flex flex-col gap-3 rounded-lg border border-border bg-white p-4 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-ink">{tenant.name}</span>
                  <StatusBadge status={tenant.status} />
                  {/* A studio with no staff is one nobody can sign in to. It is
                      a legitimate step — a studio created to receive an archive
                      starts here, and is created suspended for exactly this
                      reason — but it must never be a resting place, so it is
                      said out loud next to the name. */}
                  {tenant.staff_count === 0 && (
                    <StatusBadge status="incomplete" label="No way in" />
                  )}
                  {/* The Term runs out before the sweep writes `suspended`; the
                      studio is already refused, so the list says so too. */}
                  {tenant.term.ended && tenant.status === "active" && (
                    <StatusBadge status="suspended" label="Term ended" />
                  )}
                </div>
                <p className="mt-1 truncate text-sm text-muted">
                  {tenant.slug} · {tenant.timezone}
                </p>
                <p
                  className={`mt-0.5 truncate text-sm ${tenant.term.ended ? "text-error" : "text-muted"}`}
                >
                  {termLine(tenant)}
                </p>
                {/* Whose account this studio's money lands in. Worth a line of
                    its own rather than a badge: "the platform's" is a correct,
                    ordinary state — every studio starts there — and the account
                    id is the only thing anyone can ever see about a studio's own
                    credentials, so it is the only way to spot the wrong ones. */}
                <p className="mt-0.5 truncate text-sm text-muted">
                  {tenant.payments.configured
                    ? `Charges on its own account · ${tenant.payments.account_id}`
                    : "Charges on the platform account"}
                </p>
                <ImportProgress
                  studioName={tenant.name}
                  job={imports[tenant.id] ?? null}
                  localUpload={uploads[tenant.id] ?? null}
                  onChooseFile={() => pickArchiveFor(tenant)}
                  onDismiss={job => void dismiss(job)}
                />
                <div className="mt-2 flex flex-wrap gap-3 text-sm">
                  {tenant.urls.client && (
                    <a
                      className="inline-flex items-center gap-1 text-ink underline underline-offset-2"
                      href={tenant.urls.client}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Members <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                  {tenant.urls.portal && (
                    <a
                      className="inline-flex items-center gap-1 text-ink underline underline-offset-2"
                      href={tenant.urls.portal}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Portal <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                </div>
              </div>

              {/* One visible action at most — the thing this studio is waiting
                  on — and everything else behind the menu. Most of these are
                  done once in a studio's life; eight equal buttons on every row
                  made the rare, dangerous ones as loud as the routine ones. */}
              <div className="flex items-center gap-2">
                {/* Offered only while the studio has nobody, because that is the
                    only case the backend accepts: adding the rest of a working
                    studio's staff is that studio's own job. For a studio in this
                    state it is the only action that changes anything. */}
                {tenant.staff_count === 0 && tenant.status !== "archived" && (
                  <Button onClick={() => setInviting(tenant)}>
                    <UserPlus className="h-4 w-4" />
                    Invite admin
                  </Button>
                )}

                <RowMenu
                  label={`Actions for ${tenant.name}`}
                  busy={isBusy(tenant.id)}
                  groups={[
                    // An archived studio is terminal here: it takes no money,
                    // keeps its name, and bringing it back is a decision with
                    // data-retention consequences, not a toggle.
                    tenant.status !== "archived"
                      ? [
                          { icon: PenLine, label: "Rename", onSelect: () => setRenaming(tenant) },
                          { icon: CalendarClock, label: "Set term", onSelect: () => setTermFor(tenant) },
                          { icon: CreditCard, label: "Payments", onSelect: () => setPayingFor(tenant) },
                        ]
                      : [],
                    // Export available whatever the studio's status — taking a
                    // copy is the one action that is always safe, and the moment
                    // an operator most wants it is right before they do
                    // something they might regret.
                    [
                      { icon: Download, label: "Export archive", onSelect: () => void downloadArchive(tenant) },
                      {
                        icon: Upload,
                        label: "Restore archive",
                        // One import per studio at a time; the backend refuses a
                        // second too, but the menu should not offer it.
                        disabledReason: importBlocked(tenant.id),
                        onSelect: () => pickArchiveFor(tenant),
                      },
                    ],
                    [
                      ...(tenant.status !== "archived"
                        ? [
                            {
                              icon: tenant.status === "active" ? Pause : Play,
                              label: tenant.status === "active" ? "Suspend" : "Reactivate",
                              // A studio whose Term has ended is reactivated by
                              // extending the Term first; the item says why.
                              disabledReason:
                                tenant.status !== "active" && tenant.term.ended
                                  ? "Term has ended — extend it first"
                                  : undefined,
                              onSelect: () => void toggleSuspension(tenant),
                            },
                          ]
                        : []),
                      // Only once the studio is closed: the backend refuses to
                      // delete an active studio, and suspending first is the
                      // reversible step that proves nobody is working in it.
                      ...(tenant.status !== "active"
                        ? [{ icon: Trash2, label: "Delete studio", danger: true, onSelect: () => setDeleting(tenant) }]
                        : []),
                    ],
                  ]}
                />
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* One picker for every row. Reset on each choice so re-picking the same
          file still fires a change event. */}
      <input
        ref={fileInput}
        type="file"
        accept=".zip,application/zip"
        hidden
        onChange={event => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void uploadArchive(file);
        }}
      />

      <CreateTenantDialog
        api={api}
        open={creating}
        onOpenChange={setCreating}
        onCreated={() => {
          setCreating(false);
          void load();
        }}
      />

      <RenameTenantDialog
        // Keyed on the studio for the same reason as the invite dialog below.
        key={`rename:${renaming?.id ?? "none"}`}
        api={api}
        tenant={renaming}
        onOpenChange={open => {
          if (!open) setRenaming(null);
        }}
        onRenamed={updated => {
          setRenaming(null);
          setTenants(rows => (rows ?? []).map(row => (row.id === updated.id ? updated : row)));
        }}
      />

      <TenantTermDialog
        // Keyed on the studio, so each opening starts from that studio's Term.
        key={`term:${termFor?.id ?? "none"}`}
        api={api}
        tenant={termFor}
        onOpenChange={open => {
          if (!open) setTermFor(null);
        }}
        onSaved={updated => {
          setTermFor(null);
          setTenants(rows => (rows ?? []).map(row => (row.id === updated.id ? updated : row)));
        }}
      />

      <DeleteTenantDialog
        // Keyed on the studio, so the confirmation field starts empty each time.
        key={`delete:${deleting?.id ?? "none"}`}
        api={api}
        tenant={deleting}
        onOpenChange={open => {
          if (!open) setDeleting(null);
        }}
        onDeleted={gone => {
          setDeleting(null);
          setTenants(rows => (rows ?? []).filter(row => row.id !== gone.id));
        }}
      />

      <InviteFirstAdminDialog
        // Keyed on the studio, so closing the dialog remounts it empty rather
        // than carrying one studio's half-typed address into the next.
        key={`invite:${inviting?.id ?? "none"}`}
        api={api}
        tenant={inviting}
        onOpenChange={open => {
          if (!open) setInviting(null);
        }}
        onInvited={() => {
          setInviting(null);
          // Reloaded rather than patched in place from the response: inviting
          // also lifts the suspension the studio was opened under, and the
          // badge, the status and the Suspend button all read from that.
          void load();
        }}
      />

      <PaymentCredentialsDialog
        // Keyed on the studio, so closing remounts it empty — a secret key
        // half-typed for one studio must never still be in the field under
        // another studio's name.
        key={`pay:${payingFor?.id ?? "none"}`}
        api={api}
        // Read back out of the freshly loaded list rather than held as a
        // snapshot: saving credentials changes what the dialog says about the
        // studio, and it stays open afterwards to show the webhook URL.
        tenant={(tenants ?? []).find(row => row.id === payingFor?.id) ?? payingFor}
        onOpenChange={open => {
          if (!open) setPayingFor(null);
        }}
        onSaved={() => {
          // The dialog stays open — it has the webhook URL to show — so the row
          // behind it is refreshed rather than the dialog closed.
          void load();
        }}
      />
    </>
  );
}

type RowAction = {
  icon: LucideIcon;
  label: string;
  onSelect: () => void;
  danger?: boolean;
  /** Shown under the label, and the item is inert, when set. */
  disabledReason?: string;
};

/**
 * The ⋯ menu on a studio row. Groups are separated by a rule and empty ones
 * dropped, so the same call serves an active, suspended and archived studio.
 * While anything is in flight for the studio the trigger spins and refuses to
 * open — a second click during an import would upload the same archive twice.
 */
function RowMenu({ label, busy, groups }: { label: string; busy: boolean; groups: RowAction[][] }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const shown = groups.filter(group => group.length > 0);

  useEffect(() => {
    if (!open) return;
    function onPointer(event: PointerEvent) {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        trigger.current?.focus();
      }
    }
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={root} className="relative">
      <Button
        ref={trigger}
        variant="secondary"
        size="icon"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={busy}
        onClick={() => setOpen(o => !o)}
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <MoreHorizontal className="h-4 w-4" />}
      </Button>

      {open && (
        <div
          role="menu"
          aria-label={label}
          className="absolute right-0 top-full z-20 mt-1 w-56 rounded-md border border-border bg-card p-1 shadow-soft"
        >
          {shown.map((group, i) => (
            <div key={i} className={i > 0 ? "mt-1 border-t border-border pt-1" : undefined}>
              {group.map(action => (
                <button
                  key={action.label}
                  type="button"
                  role="menuitem"
                  disabled={Boolean(action.disabledReason)}
                  onClick={() => {
                    setOpen(false);
                    action.onSelect();
                  }}
                  className={`flex w-full items-start gap-2.5 rounded px-3 py-2 text-left text-sm hover:bg-paper disabled:pointer-events-none disabled:opacity-60 ${
                    action.danger ? "text-error" : "text-ink"
                  }`}
                >
                  <action.icon className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>
                    {action.label}
                    {action.disabledReason && (
                      <span className="block text-xs text-muted">{action.disabledReason}</span>
                    )}
                  </span>
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
