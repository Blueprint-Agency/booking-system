"use client";
import { useCallback, useEffect, useState } from "react";
import { Loader2, LogOut, Monitor, Smartphone } from "lucide-react";
import { toast } from "sonner";
import { Badge, Button } from "@/components/ui";
import { ApiError } from "@/lib/api";
import { formatDate, formatRelative } from "@/lib/formatters";
import { describeDevice, isHandheld } from "@/lib/user-agent";
import { useWorkspace } from "@/lib/workspace-context";

interface ApiSession {
  id: string;
  signed_in_at: string;
  /** Moves when the session is refreshed, about once a day — "active that day". */
  last_seen_at: string;
  expires_at: string;
  ip: string | null;
  user_agent: string | null;
  /** A superadmin opened it as this member. */
  impersonated: boolean;
}

/**
 * The sessions a member or staff member holds at this studio, on their detail
 * view (#119), with "Sign out everywhere".
 *
 * `path` is the person's API resource (`/portal/admin/clients/:id` or
 * `/portal/admin/staff/:id`); the panel reads `${path}/sessions` and posts
 * `${path}/sessions/revoke`. `refreshKey` reloads the list when something else on
 * the page changed their access — a block ends their sessions too.
 */
export function SessionsPanel({
  path,
  canRevoke,
  actions,
  refreshKey,
}: {
  path: string;
  canRevoke: boolean;
  /** Further access actions, shown beside Sign out everywhere. */
  actions?: React.ReactNode;
  refreshKey?: unknown;
}) {
  const { api } = useWorkspace();
  const [sessions, setSessions] = useState<ApiSession[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [revoking, setRevoking] = useState(false);

  const load = useCallback(async () => {
    if (!api) return;
    try {
      const res = await api.get<{ sessions: ApiSession[] }>(`${path}/sessions`);
      setSessions(res.sessions);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? `Could not load sessions (HTTP ${err.status}).` : "Could not load sessions.");
    }
  }, [api, path]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  async function revoke() {
    if (!api) return;
    setRevoking(true);
    try {
      const { revoked } = await api.post<{ revoked: number }>(`${path}/sessions/revoke`, {});
      toast.success(revoked === 1 ? "Signed out of 1 session." : `Signed out of ${revoked} sessions.`);
      setConfirming(false);
      await load();
    } catch (err) {
      const body = err instanceof ApiError ? (err.body as { message?: string } | null) : null;
      toast.error(body?.message ?? (err instanceof ApiError ? `Sign out failed (HTTP ${err.status}).` : "Sign out failed."));
    } finally {
      setRevoking(false);
    }
  }

  const count = sessions?.length ?? 0;

  return (
    <section>
      <header className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold text-ink">Sessions</h2>
        {sessions && <span className="text-xs text-muted">{count} signed in</span>}
        <div className="ml-auto flex flex-wrap items-center justify-end gap-1">
          {actions}
          {canRevoke && count > 0 && !confirming && (
            <Button size="sm" variant="ghost" onClick={() => setConfirming(true)}>
              <LogOut className="h-3.5 w-3.5" /> Sign out everywhere
            </Button>
          )}
          {confirming && (
            <>
              <Button size="sm" variant="ghost" disabled={revoking} onClick={() => setConfirming(false)}>
                Cancel
              </Button>
              <Button size="sm" variant="danger" disabled={revoking} onClick={revoke}>
                {revoking ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <LogOut className="h-3.5 w-3.5" />}
                Sign out {count === 1 ? "1 session" : `all ${count}`}
              </Button>
            </>
          )}
        </div>
      </header>

      <div className="rounded-xl border border-border bg-card shadow-soft">
        {error ? (
          <div className="flex items-center justify-between gap-2 px-4 py-3 text-sm text-error sm:px-5">
            {error}
            <Button size="sm" variant="ghost" onClick={load}>
              Retry
            </Button>
          </div>
        ) : !sessions ? (
          <div className="flex items-center gap-2 px-4 py-3 text-sm text-muted sm:px-5">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading sessions…
          </div>
        ) : sessions.length === 0 ? (
          <div className="px-4 py-3 text-sm text-muted sm:px-5">Not signed in on any device.</div>
        ) : (
          <ul className="divide-y divide-border">
            {sessions.map((s) => {
              const Icon = isHandheld(s.user_agent) ? Smartphone : Monitor;
              return (
                <li key={s.id} className="flex items-start gap-3 px-4 py-3 sm:px-5">
                  <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2 text-sm text-ink">
                      {describeDevice(s.user_agent)}
                      {s.impersonated && <Badge tone="warning">Impersonation</Badge>}
                    </div>
                    <div className="text-xs text-muted">
                      Active {formatRelative(s.last_seen_at)} · signed in {formatDate(s.signed_in_at)}
                      {s.ip ? ` · ${s.ip}` : ""}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
