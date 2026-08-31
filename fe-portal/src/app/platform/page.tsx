"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { ExternalLink, Loader2, Pause, Play, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button, EmptyState, PageHeader, StatusBadge } from "@/components/ui";
import { CreateTenantDialog } from "@/components/platform/create-tenant-dialog";
import { ApiError, makeApi } from "@/lib/api";
import { listTenants, setTenantStatus, type PlatformTenant } from "@/lib/platform";

/**
 * Every studio on the platform, and the two things that are done to one from
 * outside it: create, and suspend.
 *
 * Everything else about a studio is administered from inside the studio, by its
 * own admins. This page stays deliberately thin — a super portal that grew a
 * second copy of the admin console would be a second place for every rule to
 * drift.
 */
export default function PlatformPage() {
  const { getToken, isLoaded, isSignedIn } = useAuth();
  const api = useMemo(() => makeApi(getToken), [getToken]);

  const [tenants, setTenants] = useState<PlatformTenant[] | null>(null);
  /** Set when the backend says this account may not be here — a 404, because the
   *  super portal does not confirm its own existence to people who cannot use it. */
  const [refused, setRefused] = useState(false);
  const [creating, setCreating] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

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
                  {/* A studio missing either organization cannot authenticate in
                      that app. It should be impossible — provisioning is atomic —
                      so say so loudly if it ever happens. */}
                  {(!tenant.clerk.client || !tenant.clerk.portal) && (
                    <StatusBadge status="incomplete" label="Clerk incomplete" />
                  )}
                </div>
                <p className="mt-1 truncate text-sm text-muted">
                  {tenant.slug} · {tenant.timezone}
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

              {/* Archived studios are terminal here: bringing one back is a
                  decision with data-retention consequences, not a toggle. */}
              {tenant.status !== "archived" && (
                <Button
                  variant="secondary"
                  disabled={busyId === tenant.id}
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
            </li>
          ))}
        </ul>
      )}

      <CreateTenantDialog
        api={api}
        open={creating}
        onOpenChange={setCreating}
        onCreated={() => {
          setCreating(false);
          void load();
        }}
      />
    </>
  );
}
