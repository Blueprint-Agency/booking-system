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
  Sparkles,
  RotateCcw,
  Trash2,
  Eye,
} from "lucide-react";
import { toast } from "sonner";
import {
  Avatar,
  Badge,
  Button,
  Dialog,
  DialogFooter,
  EmptyState,
  Input,
  Label,
  PageHeader,
  Tabs,
  TabsList,
  TabsTrigger,
} from "@/components/ui";
import { ApiError } from "@/lib/api";
import { useWorkspace } from "@/lib/workspace-context";
import { formatDate, formatRelative } from "@/lib/formatters";
import {
  StaffEditDialog,
  type StaffEditPatch,
} from "@/components/staff/staff-edit-dialog";

// ---------------- API shapes ----------------

interface StaffApiRow {
  id: string;
  email: string;
  name: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  address: string | null;
  gender: "female" | "male" | "non_binary" | "prefer_not_to_say" | null;
  bio: string | null;
  languages: string[] | null;
  role: "superadmin" | "admin" | "instructor";
  status: "pending" | "active" | "archived";
  granted_location_ids: string[];
  invited_at: string | null;
  accepted_at: string | null;
  archived_at: string | null;
  is_seeded_superadmin: boolean;
  /** Assigned Days — sent for instructors only, absent on everyone else. */
  annual_leave_days?: number;
  medical_leave_days?: number;
  study_leave_days?: number;
  /** This Leave Year's figures, instructors only. Remaining is what an admin
   *  edits; Carried and Pool are the context they edit against. */
  annual_carried_days?: number;
  annual_pool_days?: number;
  annual_remaining_days?: number;
  medical_carried_days?: number;
  medical_pool_days?: number;
  medical_remaining_days?: number;
  study_carried_days?: number;
  study_pool_days?: number;
  study_remaining_days?: number;
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

type InvitableRole = "admin" | "superadmin" | "instructor";

interface StaffListResponse {
  staff: StaffApiRow[];
  invitations: InvitationApiRow[];
}

// ---------------- Page ----------------

type StaffTab = "admin" | "instructors";

export default function StaffPage() {
  const { api, currentStaff, locations } = useWorkspace();
  const [staff, setStaff] = useState<StaffApiRow[]>([]);
  const [invites, setInvites] = useState<InvitationApiRow[]>([]);
  const [tab, setTab] = useState<StaffTab>("admin");
  const [view, setView] = useState<"active" | "archived">("active");
  const [loading, setLoading] = useState(true);
  const [inviteDialog, setInviteDialog] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<InvitationApiRow | null>(null);
  const [busyInviteId, setBusyInviteId] = useState<string | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<StaffApiRow | null>(null);
  const [archiveBusy, setArchiveBusy] = useState(false);
  const [unarchiveBusyId, setUnarchiveBusyId] = useState<string | null>(null);
  const [deleteBusyId, setDeleteBusyId] = useState<string | null>(null);
  const [editTarget, setEditTarget] = useState<StaffApiRow | null>(null);

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
  const isSeededSuperadmin = currentStaff?.isSeededSuperadmin === true;

  // Mirrors the backend rank rule (be/src/services/auth/staff-rank.ts): you may
  // edit your own rank and below, never above. The BE is the enforcement point;
  // this only keeps the button off rows that would 403.
  const RANK: Record<StaffApiRow["role"], number> = {
    superadmin: 3,
    admin: 2,
    instructor: 1,
  };

  function canEditTarget(target: StaffApiRow): boolean {
    if (!currentStaff) return false;
    return RANK[target.role] <= RANK[currentStaff.role];
  }

  function canArchiveTarget(target: StaffApiRow): boolean {
    if (!isSuperadmin) return false;
    if (target.status === "archived") return false;
    if (target.id === currentStaff?.id) return false;
    if (target.is_seeded_superadmin) return false;
    if (target.role === "superadmin" && !isSeededSuperadmin) return false;
    return true;
  }

  function canManageArchived(target: StaffApiRow): boolean {
    if (!isSuperadmin) return false;
    if (target.status !== "archived") return false;
    if (target.is_seeded_superadmin) return false;
    if (target.role === "superadmin" && !isSeededSuperadmin) return false;
    return true;
  }

  async function handleUnarchive(target: StaffApiRow) {
    if (!api) return;
    setUnarchiveBusyId(target.id);
    try {
      await api.post(`/portal/admin/staff/${target.id}/unarchive`);
      toast.success(`${target.name} has been restored.`);
      await refresh();
    } catch (err) {
      if (err instanceof ApiError) {
        const body = err.body as { error?: string; message?: string } | null;
        toast.error(body?.message ?? body?.error ?? `Unarchive failed (HTTP ${err.status}).`);
      } else {
        toast.error("Unarchive failed.");
      }
    } finally {
      setUnarchiveBusyId(null);
    }
  }

  async function handleDelete(target: StaffApiRow) {
    if (!api) return;
    if (
      !window.confirm(
        `Delete ${target.name}? They will be removed from the UI and cannot be restored.`,
      )
    ) {
      return;
    }
    setDeleteBusyId(target.id);
    try {
      await api.del(`/portal/admin/staff/${target.id}`);
      toast.success(`${target.name} has been deleted.`);
      setStaff((prev) => prev.filter((s) => s.id !== target.id));
    } catch (err) {
      if (err instanceof ApiError) {
        const body = err.body as { error?: string; message?: string } | null;
        toast.error(body?.message ?? body?.error ?? `Delete failed (HTTP ${err.status}).`);
      } else {
        toast.error("Delete failed.");
      }
    } finally {
      setDeleteBusyId(null);
    }
  }

  // The PATCH echoes the whole updated row, leave figures included. Patch the
  // list with it and hand it back to the dialog, so both show the server's
  // fresh numbers without a full refetch (and reopening shows them too).
  async function handleEdit(
    id: string,
    patch: StaffEditPatch,
  ): Promise<StaffApiRow | null> {
    if (!api) return null;
    try {
      const updated = await api.patch<StaffApiRow>(`/portal/admin/staff/${id}`, patch);
      setStaff(prev => prev.map(s => (s.id === updated.id ? updated : s)));
      toast.success("Profile updated.");
      return updated;
    } catch (err) {
      if (err instanceof ApiError) {
        const body = err.body as { error?: string; message?: string } | null;
        toast.error(body?.message ?? body?.error ?? `Update failed (HTTP ${err.status}).`);
      } else {
        toast.error("Update failed.");
      }
      return null;
    }
  }

  async function handleArchive(target: StaffApiRow) {
    if (!api) return;
    setArchiveBusy(true);
    try {
      await api.post(`/portal/admin/staff/${target.id}/archive`);
      toast.success(`${target.name} has been archived.`);
      setArchiveTarget(null);
      await refresh();
    } catch (err) {
      if (err instanceof ApiError) {
        const body = err.body as { error?: string; message?: string } | null;
        toast.error(body?.message ?? body?.error ?? `Archive failed (HTTP ${err.status}).`);
      } else {
        toast.error("Archive failed.");
      }
    } finally {
      setArchiveBusy(false);
    }
  }
  const roleInTab = (role: StaffApiRow["role"], t: StaffTab) =>
    t === "instructors" ? role === "instructor" : role === "admin" || role === "superadmin";

  const tabStaff = staff.filter(s => roleInTab(s.role, tab));
  // Pending staff are already represented by their invitation row above,
  // so the main list shows only fully-accepted (active) accounts.
  const active = tabStaff.filter(s => s.status === "active");
  const archived = tabStaff.filter(s => s.status === "archived");
  const pendingInvites = invites.filter(i => i.status === "pending" && roleInTab(i.role, tab));

  // Active counts per tab for the tab labels.
  const adminCount = staff.filter(
    s => s.status === "active" && roleInTab(s.role, "admin"),
  ).length;
  const instructorCount = staff.filter(
    s => s.status === "active" && roleInTab(s.role, "instructors"),
  ).length;

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
        // Superadmin/instructor don't carry location grants — only admin does.
        granted_location_ids:
          role === "admin" && grantedLocationIds.length ? grantedLocationIds : undefined,
      });
      toast.success(`Invitation sent to ${email}.`);
      setInviteDialog(false);
      await refresh();
    } catch (err) {
      if (err instanceof ApiError) {
        const body = err.body as { error?: string; message?: string } | null;
        const code = body?.error ?? "";
        if (code === "email_in_use") {
          toast.error("That email is already on the staff list.");
          return;
        }
        if (code === "email_was_archived") {
          toast.error("That email was previously archived — restore it instead of re-inviting.");
          return;
        }
        toast.error(body?.message ?? body?.error ?? `Invite failed (HTTP ${err.status}).`);
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

      <div className="mb-6 flex gap-1 overflow-x-auto border-b border-border no-scrollbar">
        <TabButton
          active={tab === "admin"}
          onClick={() => {
            setTab("admin");
            setView("active");
          }}
        >
          Admin <TabCount n={adminCount} active={tab === "admin"} />
        </TabButton>
        <TabButton
          active={tab === "instructors"}
          onClick={() => {
            setTab("instructors");
            setView("active");
          }}
        >
          Instructors <TabCount n={instructorCount} active={tab === "instructors"} />
        </TabButton>
      </div>

      {loading ? (
        <div className="rounded-xl border border-border bg-card px-5 py-12 text-center text-sm text-muted">
          Loading staff…
        </div>
      ) : (
        <>
          {active.length + archived.length > 0 && (
            <Tabs
              value={view}
              onValueChange={v => setView(v as "active" | "archived")}
              className="mb-6"
            >
              <TabsList>
                <TabsTrigger value="active">Active ({active.length})</TabsTrigger>
                <TabsTrigger value="archived">Archived ({archived.length})</TabsTrigger>
              </TabsList>
            </Tabs>
          )}

          {view === "active" ? (
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
                      {/* basis-full below sm so the email and its sent/expires
                          line get the full row width; the badge and the two
                          actions wrap onto a second line underneath. */}
                      <div className="flex min-w-0 basis-full items-start gap-3 sm:flex-1 sm:basis-auto">
                        <Mail className="mt-1 h-4 w-4 shrink-0 text-muted" />
                        <div className="min-w-0">
                          <div className="font-medium break-all text-ink">{inv.email}</div>
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
                      </div>
                      <Badge tone="warning">Pending</Badge>
                      {isSuperadmin && (
                        <div className="ml-auto flex flex-wrap items-center justify-end gap-1">
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
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            </section>
          )}

          <section>
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted">
              {tab === "instructors" ? "Instructors" : "Admins"}
            </h2>
            {active.length === 0 ? (
              <div className="rounded-xl border border-border bg-card px-5 py-12 text-center text-sm text-muted">
                {tab === "instructors"
                  ? "No active instructors yet."
                  : "No active admins yet."}
              </div>
            ) : (
              <div className="rounded-xl border border-border bg-card shadow-soft">
                <ul className="divide-y divide-border">
                  {active.map(s => (
                    <StaffRow
                      key={s.id}
                      staff={s}
                      isSelf={s.id === currentStaff?.id}
                      canArchive={canArchiveTarget(s)}
                      onArchive={() => setArchiveTarget(s)}
                      onOpen={() => setEditTarget(s)}
                    />
                  ))}
                </ul>
              </div>
            )}
              </section>
            </>
          ) : archived.length === 0 ? (
            <EmptyState
              title="No archived staff"
              description="Archived staff will appear here."
            />
          ) : (
            <section>
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
                      canArchive={canArchiveTarget(s)}
                      onArchive={() => setArchiveTarget(s)}
                      onOpen={() => setEditTarget(s)}
                      canManageArchived={canManageArchived(s)}
                      onUnarchive={() => handleUnarchive(s)}
                      onDelete={() => handleDelete(s)}
                      unarchiveBusy={unarchiveBusyId === s.id}
                      deleteBusy={deleteBusyId === s.id}
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
          defaultRole={tab === "instructors" ? "instructor" : "admin"}
          locations={locations
            .filter(l => !l.archivedAt)
            .map(l => ({ id: l.id, name: l.name }))}
          onSubmit={handleInvite}
          onClose={() => setInviteDialog(false)}
        />
      )}

      {archiveTarget && (
        <Dialog
          open
          onOpenChange={o => !o && !archiveBusy && setArchiveTarget(null)}
          title="Archive staff?"
          description={
            archiveTarget.role === "superadmin"
              ? `This will archive superadmin ${archiveTarget.name} (${archiveTarget.email}) and immediately sign them out. They will lose all portal access. Their audit trail is preserved — this cannot be hard-deleted.`
              : `This will archive ${archiveTarget.name} (${archiveTarget.email}) and immediately sign them out. Their audit trail is preserved — this cannot be hard-deleted.`
          }
        >
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setArchiveTarget(null)}
              disabled={archiveBusy}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              disabled={archiveBusy}
              onClick={() => handleArchive(archiveTarget)}
            >
              {archiveBusy ? "Archiving…" : "Archive"}
            </Button>
          </DialogFooter>
        </Dialog>
      )}

      {editTarget && (
        <StaffEditDialog
          staff={editTarget}
          canEdit={canEditTarget(editTarget)}
          onSubmit={handleEdit}
          onClose={() => setEditTarget(null)}
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

function StaffRow({
  staff,
  isSelf,
  canArchive,
  onArchive,
  onOpen,
  canManageArchived,
  onUnarchive,
  onDelete,
  unarchiveBusy,
  deleteBusy,
}: {
  staff: StaffApiRow;
  isSelf: boolean;
  canArchive?: boolean;
  onArchive?: () => void;
  onOpen: () => void;
  canManageArchived?: boolean;
  onUnarchive?: () => void;
  onDelete?: () => void;
  unarchiveBusy?: boolean;
  deleteBusy?: boolean;
}) {
  const isArchived = staff.status === "archived";
  const isPending = staff.status === "pending";

  // basis-full below sm: the identity owns its own line on a phone, so the meta
  // and the action buttons wrap underneath instead of squeezing the name into a
  // one-word-per-line column.
  const identity = (
    <div className="flex min-w-0 basis-full items-center gap-3 sm:flex-1 sm:basis-auto">
      <Avatar name={staff.name} size={36} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="font-medium break-words text-ink">{staff.name}</span>
          {staff.role === "superadmin" && (
            <Badge tone="warning">
              <ShieldCheck className="mr-0.5 h-3 w-3" /> Superadmin
            </Badge>
          )}
          {staff.is_seeded_superadmin && (
            <Badge tone="neutral">Main</Badge>
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
        <div className="truncate text-xs text-muted">{staff.email}</div>
      </div>
    </div>
  );

  const meta = (
    <div className="shrink-0 text-xs text-muted">
      {isArchived
        ? `Archived ${staff.archived_at ? formatDate(staff.archived_at) : ""}`
        : staff.accepted_at
        ? `Joined ${formatDate(staff.accepted_at)}`
        : staff.invited_at
        ? `Invited ${formatRelative(staff.invited_at)}`
        : "—"}
    </div>
  );

  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 sm:px-5">
      {identity}
      {meta}
      <div className="ml-auto flex flex-wrap items-center justify-end gap-1">
        {/* Opens read-only; the Edit button lives inside the dialog and appears
            only for a viewer who outranks this person. */}
        <Button size="sm" variant="ghost" onClick={onOpen}>
          <Eye className="h-3.5 w-3.5" /> View
        </Button>
        {canArchive && onArchive && (
          <Button size="sm" variant="ghost" onClick={onArchive}>
            <Archive className="h-3.5 w-3.5" /> Archive
          </Button>
        )}
        {isArchived && canManageArchived && onUnarchive && (
          <Button size="sm" variant="ghost" disabled={unarchiveBusy} onClick={onUnarchive}>
            <RotateCcw className="h-3.5 w-3.5" /> Unarchive
          </Button>
        )}
        {isArchived && canManageArchived && onDelete && (
          <Button size="sm" variant="ghost" disabled={deleteBusy} onClick={onDelete}>
            <Trash2 className="h-3.5 w-3.5" /> Delete
          </Button>
        )}
      </div>
    </li>
  );
}

// ---------------- Tabs ----------------

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`-mb-px inline-flex shrink-0 items-center gap-2 whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
        active
          ? "border-accent text-ink"
          : "border-transparent text-muted hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}

function TabCount({ n, active }: { n: number; active: boolean }) {
  return (
    <span
      className={`inline-flex min-w-[20px] justify-center rounded-full px-1.5 py-0.5 text-[11px] font-semibold ${
        active ? "bg-accent/15 text-accent" : "bg-paper text-muted"
      }`}
    >
      {n}
    </span>
  );
}

// ---------------- Invite-admin dialog ----------------

function InviteAdminDialog({
  defaultRole,
  locations,
  onSubmit,
  onClose,
}: {
  defaultRole: InvitableRole;
  locations: Array<{ id: string; name: string }>;
  onSubmit: (
    email: string,
    role: InvitableRole,
    grantedLocationIds: string[],
  ) => void | Promise<void>;
  onClose: () => void;
}) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<InvitableRole>(defaultRole);
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
          {/* One card per row on a phone — three side by side leaves no room
              for the role descriptions. */}
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
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
            <button
              type="button"
              onClick={() => setRole("instructor")}
              className={`rounded-lg border px-3 py-2 text-left text-sm transition ${
                role === "instructor"
                  ? "border-accent bg-accent/5 text-ink"
                  : "border-border bg-card text-muted hover:text-ink"
              }`}
            >
              <div className="flex items-center gap-1.5 font-medium">
                <Sparkles className="h-3.5 w-3.5" /> Instructor
              </div>
              <div className="mt-0.5 text-xs text-muted">
                Teaches classes; no admin access.
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

        {role === "instructor" && (
          <p className="rounded-lg border border-border bg-paper px-3 py-2 text-xs text-muted">
            Instructors sign in to view their schedule and class rosters. They
            have no admin access and are assigned to locations through the
            schedule, not on invite.
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
