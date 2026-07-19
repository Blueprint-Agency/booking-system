"use client";
import Link from "next/link";
import { use, useCallback, useEffect, useState } from "react";
import {
  ArrowLeft,
  Mail,
  Phone,
  MoreVertical,
  ShieldOff,
  ShieldCheck,
  Loader2,
  RotateCcw,
  AlertTriangle,
} from "lucide-react";
import { toast } from "sonner";
import { Avatar, Badge, Button, Dialog, DialogFooter, Input, Label } from "@/components/ui";
import { PackageExpiryDialog } from "@/components/clients/package-expiry-dialog";
import { PackageSetBalanceDialog } from "@/components/clients/package-set-balance-dialog";
import { useWorkspace } from "@/lib/workspace-context";
import { ApiError } from "@/lib/api";
import { formatDate, formatRelative } from "@/lib/formatters";
import type { ClientPackage } from "@/types";

type PackageKind = "credit_bundle" | "unlimited" | "trial" | "pt";

interface ApiPackage {
  id: string;
  kind: PackageKind;
  source_package_id: string | null;
  package_name: string;
  credits_or_sessions_remaining: number | null;
  credits_or_sessions_total: number | null;
  expires_at: string | null;
  purchased_at: string;
  amount_paid_sgd: string;
}

interface ApiAdjustment {
  id: string;
  client_package_id: string;
  delta: number;
  reason: string;
  acted_by_staff_id: string;
  created_at: string;
}

interface ApiProfile {
  id: string;
  name: string;
  email: string;
  phone: string;
  status: "active" | "suspended";
  joined_at: string;
  suspended_at: string | null;
  deleted_at: string | null;
  deleted_by_staff_id: string | null;
  packages: ApiPackage[];
  adjustments: ApiAdjustment[];
}

/** Build the ClientPackage shape the shared edit dialogs expect. */
function toClientPackage(clientId: string, p: ApiPackage): ClientPackage {
  return {
    id: p.id,
    clientId,
    kind: p.kind,
    sourcePackageId: p.source_package_id ?? "",
    packageName: p.package_name,
    creditsOrSessionsRemaining: p.credits_or_sessions_remaining,
    creditsOrSessionsTotal: p.credits_or_sessions_total,
    expiresAt: p.expires_at,
    purchasedAt: p.purchased_at,
    amountPaidSgd: Number(p.amount_paid_sgd),
  };
}

export default function ClientProfilePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const { api, role } = useWorkspace();
  const canEdit = role === "admin" || role === "superadmin";
  const isSuperadmin = role === "superadmin";

  const [profile, setProfile] = useState<ApiProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [adjustFor, setAdjustFor] = useState<ApiPackage | null>(null);
  const [balanceFor, setBalanceFor] = useState<ApiPackage | null>(null);
  const [expiryFor, setExpiryFor] = useState<ApiPackage | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [restoring, setRestoring] = useState(false);

  const load = useCallback(async () => {
    if (!api) return;
    setLoading(true);
    setError(null);
    try {
      const res = await api.get<ApiProfile>(`/portal/admin/clients/${id}`);
      setProfile(res);
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 404
          ? "Client not found."
          : err instanceof ApiError
            ? `HTTP ${err.status}`
            : "Network error",
      );
    } finally {
      setLoading(false);
    }
  }, [api, id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function runEdit(action: () => Promise<unknown>, successMsg: string) {
    try {
      await action();
      toast.success(successMsg);
      setAdjustFor(null);
      setBalanceFor(null);
      setExpiryFor(null);
      await load();
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? `Update failed (HTTP ${err.status}).`
          : "Update failed.";
      toast.error(msg);
    }
  }

  return (
    <div className="mx-auto max-w-5xl">
      <Link
        href="/admin/clients"
        className="mb-2 inline-flex items-center gap-1 text-sm text-muted hover:text-ink"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> All clients
      </Link>

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-20 text-sm text-muted">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading client…
        </div>
      ) : error || !profile ? (
        <div className="rounded-xl border border-error/30 bg-error/5 p-8 text-center">
          <p className="text-sm text-error">{error ?? "Could not load client."}</p>
          <Button size="sm" variant="ghost" onClick={load} className="mt-2">
            Retry
          </Button>
        </div>
      ) : (
        <div className="space-y-6">
          {!canEdit && (
            <div className="rounded-lg border border-border bg-paper/60 px-3 py-2 text-xs text-muted">
              Read-only view — only admins can modify client packages and credits.
            </div>
          )}

          {profile.deleted_at && (
            <div className="flex items-start gap-3 rounded-lg border border-error/30 bg-error/5 px-4 py-3 text-sm">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-error" />
              <div className="flex-1">
                <div className="font-medium text-error">
                  Blocked {formatRelative(profile.deleted_at)}
                </div>
                <div className="mt-0.5 text-xs text-muted">
                  This client cannot sign in. Bookings, packages, and credit
                  history are preserved. Superadmins can unblock them.
                </div>
              </div>
              {isSuperadmin && (
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={restoring}
                  onClick={async () => {
                    if (!api) return;
                    setRestoring(true);
                    try {
                      await api.post(`/portal/admin/clients/${id}/restore`, {});
                      toast.success("Client unblocked.");
                      await load();
                    } catch (err) {
                      toast.error(
                        err instanceof ApiError
                          ? `Unblock failed (HTTP ${err.status}).`
                          : "Unblock failed.",
                      );
                    } finally {
                      setRestoring(false);
                    }
                  }}
                >
                  {restoring ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <RotateCcw className="h-3.5 w-3.5" />
                  )}
                  Unblock
                </Button>
              )}
            </div>
          )}

          <header className="flex items-start gap-4 border-b border-border pb-6">
            <Avatar name={profile.name} size={64} />
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <h1 className="text-2xl font-semibold text-ink">{profile.name}</h1>
                {profile.deleted_at ? (
                  <Badge tone="error">
                    <ShieldOff className="mr-1 h-3 w-3" /> Blocked
                  </Badge>
                ) : (
                  <Badge tone="sage">
                    <ShieldCheck className="mr-1 h-3 w-3" /> Active
                  </Badge>
                )}
              </div>
              <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted">
                <span className="inline-flex items-center gap-1.5">
                  <Mail className="h-3 w-3" /> {profile.email}
                </span>
                <span className="inline-flex items-center gap-1.5 font-mono">
                  <Phone className="h-3 w-3" /> {profile.phone || "—"}
                </span>
                <span>Joined {formatDate(profile.joined_at)}</span>
              </div>
            </div>
            {isSuperadmin && !profile.deleted_at && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setDeleteOpen(true)}
                className="text-error hover:bg-error/10 hover:text-error"
              >
                <ShieldOff className="h-3.5 w-3.5" /> Block
              </Button>
            )}
          </header>

          <section>
            <header className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-ink">Active packages</h2>
              <span className="text-xs text-muted">{profile.packages.length} active</span>
            </header>
            {profile.packages.length === 0 ? (
              <div className="rounded-xl border border-border bg-card px-5 py-10 text-center text-sm text-muted shadow-soft">
                No active packages.
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                {profile.packages.map((p) => {
                  const kindTone =
                    p.kind === "credit_bundle"
                      ? "accent"
                      : p.kind === "unlimited"
                        ? "warning"
                        : p.kind === "trial"
                          ? "sage"
                          : "cyan";
                  const kindLabel =
                    p.kind === "credit_bundle"
                      ? "Credit"
                      : p.kind === "unlimited"
                        ? "Unlimited"
                        : p.kind === "trial"
                          ? "Trial"
                          : "PT";
                  const canEditExpiry =
                    p.kind === "credit_bundle" || p.kind === "unlimited" || p.kind === "trial";
                  const canSetBalance = p.kind === "credit_bundle" || p.kind === "trial";
                  const canAdjustDelta = p.kind !== "unlimited";
                  const showMenu = canEdit && (canEditExpiry || canSetBalance || canAdjustDelta);
                  return (
                    <div
                      key={p.id}
                      className="relative rounded-xl border border-border bg-card p-4 shadow-soft"
                    >
                      <div className="mb-1 flex items-center gap-2">
                        <span className="font-medium text-ink">{p.package_name}</span>
                        <Badge tone={kindTone}>{kindLabel}</Badge>
                        <div className="flex-1" />
                        {showMenu && (
                          <button
                            type="button"
                            onClick={() => setOpenMenuId((m) => (m === p.id ? null : p.id))}
                            className="rounded p-1 text-muted hover:bg-paper hover:text-ink"
                            aria-label="Package actions"
                          >
                            <MoreVertical className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                      {showMenu && openMenuId === p.id && (
                        <div className="absolute right-2 top-10 z-20 w-52 rounded-md border border-border bg-card p-1 shadow-soft">
                          {canSetBalance && (
                            <MenuButton
                              label="Set credit balance"
                              onClick={() => {
                                setBalanceFor(p);
                                setOpenMenuId(null);
                              }}
                            />
                          )}
                          {canEditExpiry && (
                            <MenuButton
                              label="Edit expiry"
                              onClick={() => {
                                setExpiryFor(p);
                                setOpenMenuId(null);
                              }}
                            />
                          )}
                          {canAdjustDelta && (
                            <MenuButton
                              label="Manual adjustment"
                              onClick={() => {
                                setAdjustFor(p);
                                setOpenMenuId(null);
                              }}
                            />
                          )}
                        </div>
                      )}
                      {p.credits_or_sessions_remaining !== null ? (
                        <div className="font-mono text-sm text-ink">
                          {p.credits_or_sessions_remaining}
                          {p.credits_or_sessions_total !== null
                            ? ` / ${p.credits_or_sessions_total}`
                            : ""}{" "}
                          {p.kind === "pt" ? "sessions" : "credits"}
                        </div>
                      ) : (
                        <div className="font-mono text-sm text-ink">Unlimited</div>
                      )}
                      <div className="text-xs text-muted">
                        {p.expires_at ? `Valid until ${formatDate(p.expires_at)}` : "No expiry"}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {profile.adjustments.length > 0 && (
            <section>
              <h2 className="mb-3 text-sm font-semibold text-ink">Package adjustments</h2>
              <div className="rounded-xl border border-border bg-card shadow-soft">
                <ul className="divide-y divide-border">
                  {profile.adjustments.map((a) => {
                    const pkg = profile.packages.find((p) => p.id === a.client_package_id);
                    const isExpiry = a.reason.startsWith("Expiry");
                    const isSet = a.reason.startsWith("Set ");
                    const badge = isExpiry ? (
                      <Badge tone="neutral">Expiry</Badge>
                    ) : isSet ? (
                      <Badge tone="accent">Set</Badge>
                    ) : (
                      <Badge tone={a.delta > 0 ? "sage" : "error"}>
                        {a.delta > 0 ? "+" : ""}
                        {a.delta}
                      </Badge>
                    );
                    return (
                      <li key={a.id} className="flex items-start gap-3 px-5 py-3">
                        {badge}
                        <div className="min-w-0 flex-1">
                          <div className="text-sm text-ink">
                            {pkg?.package_name ?? "Package"}
                          </div>
                          <div className="text-xs text-muted">{a.reason}</div>
                        </div>
                        <span className="text-xs text-muted">{formatRelative(a.created_at)}</span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            </section>
          )}
        </div>
      )}

      {canEdit && adjustFor && (
        <AdjustmentDialog
          pkg={adjustFor}
          onSubmit={(delta, reason) =>
            runEdit(
              () =>
                api!.post(`/portal/admin/clients/${id}/packages/${adjustFor.id}/adjust`, {
                  delta,
                  reason,
                }),
              "Balance adjusted.",
            )
          }
          onClose={() => setAdjustFor(null)}
        />
      )}

      {canEdit && balanceFor && (
        <PackageSetBalanceDialog
          pkg={toClientPackage(id, balanceFor)}
          onSave={(newBal, reason) =>
            runEdit(
              () =>
                api!.post(`/portal/admin/clients/${id}/packages/${balanceFor.id}/balance`, {
                  balance: newBal,
                  reason,
                }),
              "Balance updated.",
            )
          }
          onClose={() => setBalanceFor(null)}
        />
      )}

      {canEdit && expiryFor && (
        <PackageExpiryDialog
          pkg={toClientPackage(id, expiryFor)}
          onSave={(newExp, reason) =>
            runEdit(
              () =>
                api!.post(`/portal/admin/clients/${id}/packages/${expiryFor.id}/expiry`, {
                  expires_at: newExp,
                  reason,
                }),
              "Expiry updated.",
            )
          }
          onClose={() => setExpiryFor(null)}
        />
      )}

      {isSuperadmin && deleteOpen && profile && (
        <BlockClientDialog
          email={profile.email}
          name={profile.name}
          onClose={() => setDeleteOpen(false)}
          onConfirm={async () => {
            if (!api) return;
            try {
              await api.del(`/portal/admin/clients/${id}`);
              toast.success("Client blocked.");
              setDeleteOpen(false);
              await load();
            } catch (err) {
              toast.error(
                err instanceof ApiError
                  ? `Block failed (HTTP ${err.status}).`
                  : "Block failed.",
              );
            }
          }}
        />
      )}
    </div>
  );
}

function BlockClientDialog({
  email,
  name,
  onClose,
  onConfirm,
}: {
  email: string;
  name: string;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}) {
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const matches = typed.trim().toLowerCase() === email.trim().toLowerCase();
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={`Block ${name}?`}
      description="The client will be locked out of the booking app and hidden from the directory. Bookings, packages, and credit history are kept. A superadmin can unblock them later."
    >
      <form
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!matches || busy) return;
          setBusy(true);
          try {
            await onConfirm();
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="space-y-1.5">
          <Label htmlFor="confirm-email">
            Type <span className="font-mono text-ink">{email}</span> to confirm
          </Label>
          <Input
            id="confirm-email"
            autoFocus
            autoComplete="off"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder={email}
          />
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={!matches || busy}
            className="bg-error text-white hover:bg-error/90"
          >
            {busy ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" /> Blocking…
              </>
            ) : (
              <>
                <ShieldOff className="h-4 w-4" /> Block client
              </>
            )}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}

function MenuButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="block w-full rounded px-3 py-2 text-left text-sm hover:bg-paper"
    >
      {label}
    </button>
  );
}

function AdjustmentDialog({
  pkg,
  onSubmit,
  onClose,
}: {
  pkg: ApiPackage;
  onSubmit: (delta: number, reason: string) => void;
  onClose: () => void;
}) {
  const [delta, setDelta] = useState("");
  const [reason, setReason] = useState("");
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={`Manual adjustment — ${pkg.package_name}`}
      description="Use a signed integer (e.g. +3 or −1). Audit-logged with your name."
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          const n = Number(delta);
          if (!n || !reason.trim()) return;
          onSubmit(n, reason.trim());
        }}
      >
        <div className="text-sm text-muted">
          Current balance:{" "}
          <strong className="text-ink">{pkg.credits_or_sessions_remaining ?? 0}</strong>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="delta">Adjustment</Label>
          <Input
            id="delta"
            required
            type="number"
            value={delta}
            onChange={(e) => setDelta(e.target.value)}
            placeholder="+1, -2, …"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="reason">Reason</Label>
          <textarea
            id="reason"
            required
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Free text — required for the audit log."
            className="flex min-h-[80px] w-full rounded-lg border border-border bg-card px-3 py-2 text-sm placeholder:text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          />
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit">Apply adjustment</Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
