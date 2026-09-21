"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CreditCard,
  Download,
  ExternalLink,
  Loader2,
  Pause,
  PenLine,
  Play,
  Plus,
  Upload,
  UserPlus,
} from "lucide-react";
import { toast } from "sonner";
import { Button, EmptyState, PageHeader, StatusBadge } from "@/components/ui";
import { CreateTenantDialog } from "@/components/platform/create-tenant-dialog";
import { InviteFirstAdminDialog } from "@/components/platform/invite-first-admin-dialog";
import { RenameTenantDialog } from "@/components/platform/rename-tenant-dialog";
import { PaymentCredentialsDialog } from "@/components/platform/payment-credentials-dialog";
import { ApiError, makeApi } from "@/lib/api";
import {
  exportTenant,
  importTenant,
  listTenants,
  setTenantStatus,
  type PlatformTenant,
} from "@/lib/platform";
import { getPortalToken, usePortalSession } from "@/lib/portal-auth";

/**
 * Every studio on the platform, and the few things that are done to one from
 * outside it: create, suspend, rename, and move its data in or out.
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
  const [busyId, setBusyId] = useState<string | null>(null);
  /** One file input serves every row; this is the studio the picker is for. */
  const [importTarget, setImportTarget] = useState<PlatformTenant | null>(null);
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
   * Is anything in flight for this studio?
   *
   * One `busyId` serves every row, and the three actions tag it differently —
   * the status toggle with the bare id, export and import with a prefix. A
   * button comparing against only one of those spins while staying clickable,
   * and a second click during an import uploads the same archive twice into the
   * same studio.
   */
  function isBusy(id: string) {
    return busyId === id || busyId === `export:${id}` || busyId === `import:${id}`;
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
    } catch {
      toast.error("Could not change the studio's status.");
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

  async function uploadArchive(file: File) {
    const tenant = importTarget;
    if (!tenant) return;
    setImportTarget(null);

    if (
      !window.confirm(
        `Restore an archive into ${tenant.name}? It must have no data of its own yet, and everything in the file is written exactly as it was.`,
      )
    ) {
      return;
    }

    setBusyId(`import:${tenant.id}`);
    try {
      const summary = await importTenant(api, tenant.id, file);
      const what = summary.remapped
        ? `Copied ${summary.imported.toLocaleString()} rows from ${summary.from.name} into ${tenant.name}. ${summary.from.name} is untouched.`
        : `Restored ${summary.imported.toLocaleString()} rows from ${summary.from.name} into ${tenant.name}.`;
      // A studio created with no admin opens suspended. If the archive brought
      // its staff, that is the moment it became a working studio, and the
      // operator should not have to notice the badge to find out.
      toast.success(summary.opened ? `${what} ${tenant.name} is now open.` : what);
      await load();
    } catch (err) {
      // The backend refuses with a sentence rather than a code — a studio that
      // already has rows, or an archive from another version — and that sentence
      // is the only thing that tells the operator what to do next.
      const message =
        err instanceof ApiError && typeof err.body === "object" && err.body !== null
          ? (err.body as { message?: string }).message
          : undefined;
      toast.error(message ?? `Could not restore into ${tenant.name}.`);
    } finally {
      setBusyId(null);
    }
  }

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
              <div className="min-w-0">
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
                </div>
                <p className="mt-1 truncate text-sm text-muted">
                  {tenant.slug} · {tenant.timezone}
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

              <div className="flex flex-wrap items-center gap-2">
                {/* Offered only while the studio has nobody, because that is the
                    only case the backend accepts: adding the rest of a working
                    studio's staff is that studio's own job. First in the row —
                    for a studio in this state it is the only action that
                    changes anything. */}
                {tenant.staff_count === 0 && tenant.status !== "archived" && (
                  <Button onClick={() => setInviting(tenant)}>
                    <UserPlus className="h-4 w-4" />
                    Invite admin
                  </Button>
                )}

                {/* An archived studio takes no money, so there is nothing to
                    point at an account. */}
                {tenant.status !== "archived" && (
                  <Button
                    variant="secondary"
                    disabled={isBusy(tenant.id)}
                    onClick={() => setPayingFor(tenant)}
                  >
                    <CreditCard className="h-4 w-4" />
                    Payments
                  </Button>
                )}

                {/* Export first, and available whatever the studio's status —
                    taking a copy is the one action that is always safe, and the
                    moment an operator most wants it is right before they do
                    something they might regret. */}
                <Button
                  variant="secondary"
                  disabled={isBusy(tenant.id)}
                  onClick={() => void downloadArchive(tenant)}
                >
                  {busyId === `export:${tenant.id}` ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Download className="h-4 w-4" />
                  )}
                  Export
                </Button>

                <Button
                  variant="secondary"
                  disabled={isBusy(tenant.id)}
                  onClick={() => pickArchiveFor(tenant)}
                >
                  {busyId === `import:${tenant.id}` ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Upload className="h-4 w-4" />
                  )}
                  Import
                </Button>

                {tenant.status !== "archived" && (
                  <Button
                    variant="secondary"
                    disabled={isBusy(tenant.id)}
                    onClick={() => setRenaming(tenant)}
                  >
                    <PenLine className="h-4 w-4" />
                    Rename
                  </Button>
                )}

                {/* Archived studios are terminal here: bringing one back is a
                    decision with data-retention consequences, not a toggle. */}
                {tenant.status !== "archived" && (
                  <Button
                    variant="secondary"
                    disabled={isBusy(tenant.id)}
                    onClick={() => void toggleSuspension(tenant)}
                  >
                    {busyId === tenant.id ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : tenant.status === "active" ? (
                      <Pause className="h-4 w-4" />
                    ) : (
                      <Play className="h-4 w-4" />
                    )}
                    {tenant.status === "active" ? "Suspend" : "Reactivate"}
                  </Button>
                )}
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

      <InviteFirstAdminDialog
        // Keyed on the studio, so closing the dialog remounts it empty rather
        // than carrying one studio's half-typed address into the next.
        key={inviting?.id ?? "none"}
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
        key={payingFor?.id ?? "none"}
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
