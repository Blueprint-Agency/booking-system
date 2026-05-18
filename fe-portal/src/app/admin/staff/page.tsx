"use client";
import { useCallback, useEffect, useState } from "react";
import {
  Plus,
  Mail,
  Archive,
  RefreshCw,
  X,
  Shield,
  ShieldCheck,
} from "lucide-react";
import { toast } from "sonner";
import {
  Avatar,
  Badge,
  Button,
  Dialog,
  DialogFooter,
  Input,
  Label,
  PageHeader,
} from "@/components/ui";
import { ApiError } from "@/lib/api";
import { useWorkspace } from "@/lib/workspace-context";
import { formatDate, formatRelative } from "@/lib/formatters";

// ---------------- API shapes ----------------

interface StaffApiRow {
  id: string;
  email: string;
  name: string;
  role: "superadmin" | "admin" | "instructor";
  status: "pending" | "active" | "archived";
  granted_location_ids: string[];
  invited_at: string | null;
  accepted_at: string | null;
  archived_at: string | null;
}

interface InvitationApiRow {
  id: string;
  email: string;
  role: "superadmin" | "admin" | "instructor";
  status: "pending" | "accepted" | "revoked" | "expired";
  granted_location_ids: string[];
  expires_at: string;
  created_at: string;
  invited_by_staff_name: string | null;
}

type InvitableRole = "admin" | "superadmin";

interface StaffListResponse {
  staff: StaffApiRow[];
  invitations: InvitationApiRow[];
}

// ---------------- Page ----------------

export default function StaffPage() {
  const { api, currentStaff, locations } = useWorkspace();
  const [staff, setStaff] = useState<StaffApiRow[]>([]);
  const [invites, setInvites] = useState<InvitationApiRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [inviteDialog, setInviteDialog] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<InvitationApiRow | null>(null);
  const [busyInviteId, setBusyInviteId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!api) return;
    setLoading(true);
    try {
      const data = await api.get<StaffListResponse>("/portal/admin/staff");
      setStaff(data.staff);
      setInvites(data.invitations);
    } catch (err) {
      const msg =
        err instanceof ApiError ? `Failed to load (HTTP ${err.status}).` : "Failed to load.";
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const isSuperadmin = currentStaff?.role === "superadmin";
  const active = staff.filter(s => s.status !== "archived");
  const archived = staff.filter(s => s.status === "archived");
  const pendingInvites = invites.filter(i => i.status === "pending");

  async function handleInvite(
    email: string,
    role: InvitableRole,
    grantedLocationIds: string[],
  ) {
    if (!api) return;
    try {
      await api.post("/portal/admin/staff/invite", {
        email,
        role,
        // Superadmin always gets implicit grant to all locations — ignore the field.
        granted_location_ids:
          role === "admin" && grantedLocationIds.length ? grantedLocationIds : undefined,
      });
      toast.success(`Invitation sent to ${email}.`);
      setInviteDialog(false);
      await refresh();
    } catch (err) {
      if (err instanceof ApiError) {
        const body = err.body as { error?: string; details?: { message?: string } } | null;
        const code = body?.error ?? "";
        if (code === "email_in_use") {
          toast.error("That email is already on the staff list.");
          return;
        }
        if (code === "email_was_archived") {
          toast.error("That email was previously archived — restore it instead of re-inviting.");
          return;
        }
        toast.error(body?.details?.message ?? `Invite failed (HTTP ${err.status}).`);
      } else {
        toast.error("Invite failed.");
      }
    }
  }

  async function handleResend(inv: InvitationApiRow) {
    if (!api) return;
    setBusyInviteId(inv.id);
    try {
      await api.post(`/portal/admin/staff/invitations/${inv.id}/resend`);
      toast.success(`Invitation re-sent to ${inv.email}.`);
      await refresh();
    } catch (err) {
      const msg = err instanceof ApiError ? `Resend failed (HTTP ${err.status}).` : "Resend failed.";
      toast.error(msg);
    } finally {
      setBusyInviteId(null);
    }
  }

  async function handleRevoke(inv: InvitationApiRow) {
    if (!api) return;
    setBusyInviteId(inv.id);
    try {
      await api.post(`/portal/admin/staff/invitations/${inv.id}/revoke`);
      toast.success(`Invitation to ${inv.email} revoked.`);
      setRevokeTarget(null);
      await refresh();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        toast.error("That invitation has already been accepted.");
      } else {
        toast.error("Revoke failed.");
      }
    } finally {
      setBusyInviteId(null);
    }
  }

  return (
    <div>
      <PageHeader
        title="Staff"
        description="Admins and instructors. Roles are mutually exclusive — one email holds one staff account. Archived accounts can never be hard-deleted (audit log integrity)."
        actions={
          isSuperadmin ? (
            <Button onClick={() => setInviteDialog(true)}>
              <Plus className="h-4 w-4" /> Invite staff
            </Button>
          ) : null
        }
      />

      {loading ? (
        <div className="rounded-xl border border-border bg-card px-5 py-12 text-center text-sm text-muted">
          Loading staff…
        </div>
      ) : (
        <>
          {pendingInvites.length > 0 && (
            <section className="mb-8">
              <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted">
                Pending invitations
              </h2>
              <div className="rounded-xl border border-border bg-card shadow-soft">
                <ul className="divide-y divide-border">
                  {pendingInvites.map(inv => (
                    <li
                      key={inv.id}
                      className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3"
                    >
                      <Mail className="h-4 w-4 text-muted" />
                      <div className="min-w-0 flex-1">
                        <div className="font-medium text-ink">{inv.email}</div>
                        <div className="text-xs text-muted">
                          {inv.role === "superadmin"
                            ? "Superadmin"
                            : inv.role === "admin"
                            ? "Admin"
                            : "Instructor"}{" "}
                          · sent{" "}
                          {formatRelative(inv.created_at)} · expires{" "}
                          {formatRelative(inv.expires_at)}
                          {inv.invited_by_staff_name ? ` · by ${inv.invited_by_staff_name}` : ""}
                        </div>
                      </div>
                      <Badge tone="warning">Pending</Badge>
                      {isSuperadmin && (
                        <>
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={busyInviteId === inv.id}
                            onClick={() => handleResend(inv)}
                          >
                            <RefreshCw className="h-3.5 w-3.5" /> Resend
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={busyInviteId === inv.id}
                            onClick={() => setRevokeTarget(inv)}
                          >
                            <X className="h-3.5 w-3.5" /> Revoke
                          </Button>
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            </section>
          )}

          <section>
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted">
              Staff
            </h2>
            {active.length === 0 ? (
              <div className="rounded-xl border border-border bg-card px-5 py-12 text-center text-sm text-muted">
                No active staff yet.
              </div>
            ) : (
              <div className="rounded-xl border border-border bg-card shadow-soft">
                <ul className="divide-y divide-border">
                  {active.map(s => (
                    <StaffRow
                      key={s.id}
                      staff={s}
                      isSelf={s.id === currentStaff?.id}
                    />
                  ))}
                </ul>
              </div>
            )}
          </section>

          {archived.length > 0 && (
            <section className="mt-8">
              <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted">
                Archived
              </h2>
              <div className="rounded-xl border border-border bg-card opacity-80 shadow-soft">
                <ul className="divide-y divide-border">
                  {archived.map(s => (
                    <StaffRow
                      key={s.id}
                      staff={s}
                      isSelf={s.id === currentStaff?.id}
                    />
                  ))}
                </ul>
              </div>
            </section>
          )}
        </>
      )}

      {inviteDialog && (
        <InviteAdminDialog
          locations={locations
            .filter(l => !l.archivedAt)
            .map(l => ({ id: l.id, name: l.name }))}
          onSubmit={handleInvite}
          onClose={() => setInviteDialog(false)}
        />
      )}

      {revokeTarget && (
        <Dialog
          open
          onOpenChange={o => !o && setRevokeTarget(null)}
          title={`Revoke invitation?`}
          description={`This will cancel the pending invitation to ${revokeTarget.email}. They will not be able to sign up using the link.`}
        >
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRevokeTarget(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              disabled={busyInviteId === revokeTarget.id}
              onClick={() => handleRevoke(revokeTarget)}
            >
              Revoke
            </Button>
          </DialogFooter>
        </Dialog>
      )}
    </div>
  );
}

// ---------------- Staff row ----------------

function StaffRow({ staff, isSelf }: { staff: StaffApiRow; isSelf: boolean }) {
  const isArchived = staff.status === "archived";
  const isPending = staff.status === "pending";

  return (
    <li className="flex items-center gap-4 px-5 py-3">
      <Avatar name={staff.name} size={36} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-medium text-ink">{staff.name}</span>
          {staff.role === "superadmin" && (
            <Badge tone="warning">
              <ShieldCheck className="mr-0.5 h-3 w-3" /> Superadmin
            </Badge>
          )}
          {staff.role === "admin" && (
            <Badge tone="accent">
              <Shield className="mr-0.5 h-3 w-3" /> Admin
            </Badge>
          )}
          {staff.role === "instructor" && <Badge tone="cyan">Instructor</Badge>}
          {isPending && <Badge tone="warning">Pending invite</Badge>}
          {isSelf && <span className="text-xs text-muted">(you)</span>}
        </div>
        <div className="text-xs text-muted">{staff.email}</div>
      </div>
      <div className="text-xs text-muted">
        {isArchived
          ? `Archived ${staff.archived_at ? formatDate(staff.archived_at) : ""}`
          : staff.accepted_at
          ? `Joined ${formatDate(staff.accepted_at)}`
          : staff.invited_at
          ? `Invited ${formatRelative(staff.invited_at)}`
          : "—"}
      </div>
      {/* Archive action will be wired when the backend archive route lands. */}
      {!isArchived && !isSelf && staff.role !== "superadmin" && (
        <Button size="sm" variant="ghost" disabled title="Archive — not yet implemented">
          <Archive className="h-3.5 w-3.5" /> Archive
        </Button>
      )}
    </li>
  );
}

// ---------------- Invite-admin dialog ----------------

function InviteAdminDialog({
  locations,
  onSubmit,
  onClose,
}: {
  locations: Array<{ id: string; name: string }>;
  onSubmit: (
    email: string,
    role: InvitableRole,
    grantedLocationIds: string[],
  ) => void | Promise<void>;
  onClose: () => void;
}) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<InvitableRole>("admin");
  const [grantedIds, setGrantedIds] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const allLocations = grantedIds.length === 0;

  function toggleLocation(id: string) {
    setGrantedIds(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id],
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setSubmitting(true);
    try {
      await onSubmit(email.trim(), role, grantedIds);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open
      onOpenChange={o => !o && !submitting && onClose()}
      title="Invite staff"
      description="They will receive an email with a sign-up link. The invitation expires in 7 days."
    >
      <form className="space-y-4" onSubmit={handleSubmit}>
        <div className="space-y-1.5">
          <Label htmlFor="invite-email">Email</Label>
          <Input
            id="invite-email"
            type="email"
            required
            autoFocus
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="name@yogasadhana.sg"
          />
        </div>

        <div className="space-y-1.5">
          <Label>Role</Label>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setRole("admin")}
              className={`rounded-lg border px-3 py-2 text-left text-sm transition ${
                role === "admin"
                  ? "border-accent bg-accent/5 text-ink"
                  : "border-border bg-card text-muted hover:text-ink"
              }`}
            >
              <div className="flex items-center gap-1.5 font-medium">
                <Shield className="h-3.5 w-3.5" /> Admin
              </div>
              <div className="mt-0.5 text-xs text-muted">
                Workspace-scoped ops staff.
              </div>
            </button>
            <button
              type="button"
              onClick={() => setRole("superadmin")}
              className={`rounded-lg border px-3 py-2 text-left text-sm transition ${
                role === "superadmin"
                  ? "border-accent bg-accent/5 text-ink"
                  : "border-border bg-card text-muted hover:text-ink"
              }`}
            >
              <div className="flex items-center gap-1.5 font-medium">
                <ShieldCheck className="h-3.5 w-3.5" /> Superadmin
              </div>
              <div className="mt-0.5 text-xs text-muted">
                Full access, all locations.
              </div>
            </button>
          </div>
        </div>

        {role === "admin" && (
          <div className="space-y-1.5">
            <Label>Location access</Label>
            {locations.length === 0 ? (
              <p className="text-xs text-muted">
                No active locations — the admin will have access to all locations.
              </p>
            ) : (
              <>
                <p className="text-xs text-muted">
                  Leave all unchecked to grant access to all locations.
                </p>
                <div className="space-y-1 rounded-lg border border-border bg-paper p-2">
                  {locations.map(loc => (
                    <label
                      key={loc.id}
                      className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-warm"
                    >
                      <input
                        type="checkbox"
                        checked={grantedIds.includes(loc.id)}
                        onChange={() => toggleLocation(loc.id)}
                        className="h-4 w-4 rounded border-border accent-accent"
                      />
                      <span className={allLocations ? "text-muted" : "text-ink"}>
                        {loc.name}
                      </span>
                    </label>
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        {role === "superadmin" && (
          <p className="rounded-lg border border-border bg-paper px-3 py-2 text-xs text-muted">
            Superadmins have full access across all locations and can manage other
            staff, including other superadmins. The main seeded superadmin is set
            via the <code className="text-ink">SUPERADMIN_EMAIL</code> env var.
          </p>
        )}

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button type="submit" disabled={submitting || !email.trim()}>
            {submitting ? "Sending…" : "Send invite"}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
