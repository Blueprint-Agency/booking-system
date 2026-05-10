"use client";
import { useState } from "react";
import { Plus, Mail, Archive, RotateCcw, RefreshCw, X, Shield, ShieldCheck } from "lucide-react";
import { Avatar, Badge, Button, Dialog, DialogFooter, Input, Label, PageHeader } from "@/components/ui";
import { staffUsers as seedStaff, staffInvitations as seedInvites } from "@/data";
import { formatDate, formatRelative } from "@/lib/formatters";
import type { StaffUser, StaffInvitation } from "@/types";

// Mock current user. Per §15a, superadmin = admin in UI but with extra archive power.
const CURRENT_STAFF = { id: "stf-super", role: "superadmin" as const };

export default function StaffPage() {
  const [staff, setStaff] = useState<StaffUser[]>(seedStaff);
  const [invites, setInvites] = useState<StaffInvitation[]>(seedInvites);
  const [inviteDialog, setInviteDialog] = useState(false);
  const [archiveTarget, setArchiveTarget] = useState<StaffUser | null>(null);

  const active = staff.filter((s) => s.status !== "archived");
  const archived = staff.filter((s) => s.status === "archived");
  const pendingInvites = invites.filter((i) => i.status === "pending");

  const canArchiveAdmin = CURRENT_STAFF.role === "superadmin";

  function archive(target: StaffUser) {
    setStaff((p) =>
      p.map((s) =>
        s.id === target.id
          ? {
              ...s,
              status: "archived",
              archivedAt: new Date().toISOString(),
              archivedByStaffId: CURRENT_STAFF.id,
            }
          : s
      )
    );
    setArchiveTarget(null);
    alert(`${target.name} archived (mock).\n\nActive sessions force-logged-out.`);
  }

  function restore(target: StaffUser) {
    setStaff((p) =>
      p.map((s) =>
        s.id === target.id
          ? { ...s, status: "active", archivedAt: null, archivedByStaffId: null }
          : s
      )
    );
  }

  function sendInvite(email: string, role: "admin" | "instructor") {
    const inv: StaffInvitation = {
      id: `inv-${Date.now().toString(36)}`,
      email,
      role,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      status: "pending",
      invitedByStaffId: CURRENT_STAFF.id,
      createdAt: new Date().toISOString(),
    };
    setInvites((p) => [...p, inv]);
    setInviteDialog(false);
    alert(`Invite sent to ${email} (mock). Token expires in 7 days.`);
  }

  function revoke(inv: StaffInvitation) {
    setInvites((p) =>
      p.map((i) => (i.id === inv.id ? { ...i, status: "revoked" } : i))
    );
  }

  function resend(inv: StaffInvitation) {
    setInvites((p) =>
      p.map((i) =>
        i.id === inv.id
          ? {
              ...i,
              expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
              createdAt: new Date().toISOString(),
            }
          : i
      )
    );
    alert(`Fresh invite re-sent to ${inv.email} (mock).`);
  }

  return (
    <div>
      <PageHeader
        title="Staff"
        description="Admins and instructors. Roles are mutually exclusive — one email holds one staff account. Archived accounts can never be hard-deleted (audit log integrity)."
        actions={
          <Button onClick={() => setInviteDialog(true)}>
            <Plus className="h-4 w-4" /> Invite
          </Button>
        }
      />

      {pendingInvites.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted">
            Pending invites
          </h2>
          <div className="rounded-xl border border-border bg-card shadow-soft">
            <ul className="divide-y divide-border">
              {pendingInvites.map((inv) => (
                <li key={inv.id} className="flex items-center gap-4 px-5 py-3">
                  <Mail className="h-4 w-4 text-muted" />
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-ink">{inv.email}</div>
                    <div className="text-xs text-muted">
                      {inv.role === "admin" ? "Admin" : "Instructor"} · expires{" "}
                      {formatRelative(inv.expiresAt)}
                    </div>
                  </div>
                  <Badge tone="warning">Pending</Badge>
                  <Button size="sm" variant="ghost" onClick={() => resend(inv)}>
                    <RefreshCw className="h-3.5 w-3.5" /> Resend
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => revoke(inv)}>
                    <X className="h-3.5 w-3.5" /> Revoke
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}

      <section>
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted">Active</h2>
        <div className="rounded-xl border border-border bg-card shadow-soft">
          <ul className="divide-y divide-border">
            {active.map((s) => (
              <StaffRow
                key={s.id}
                staff={s}
                isSelf={s.id === CURRENT_STAFF.id}
                canArchiveAdmin={canArchiveAdmin}
                onArchive={() => setArchiveTarget(s)}
                onRestore={() => restore(s)}
              />
            ))}
          </ul>
        </div>
      </section>

      {archived.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted">
            Archived
          </h2>
          <div className="rounded-xl border border-border bg-card opacity-80 shadow-soft">
            <ul className="divide-y divide-border">
              {archived.map((s) => (
                <StaffRow
                  key={s.id}
                  staff={s}
                  isSelf={s.id === CURRENT_STAFF.id}
                  canArchiveAdmin={canArchiveAdmin}
                  onArchive={() => setArchiveTarget(s)}
                  onRestore={() => restore(s)}
                />
              ))}
            </ul>
          </div>
        </section>
      )}

      {inviteDialog && (
        <InviteDialog onSubmit={sendInvite} onClose={() => setInviteDialog(false)} />
      )}

      {archiveTarget && (
        <Dialog
          open
          onOpenChange={(o) => !o && setArchiveTarget(null)}
          title={`Archive ${archiveTarget.name}?`}
          description={`Active sessions will be force-logged-out immediately. ${
            archiveTarget.role === "instructor"
              ? "Past sessions remain in records. Cannot archive if upcoming/ongoing sessions exist."
              : "Pending invites this admin sent will remain valid."
          }`}
        >
          <DialogFooter>
            <Button variant="ghost" onClick={() => setArchiveTarget(null)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={() => archive(archiveTarget)}>
              Archive
            </Button>
          </DialogFooter>
        </Dialog>
      )}
    </div>
  );
}

function StaffRow({
  staff,
  isSelf,
  canArchiveAdmin,
  onArchive,
  onRestore,
}: {
  staff: StaffUser;
  isSelf: boolean;
  canArchiveAdmin: boolean;
  onArchive: () => void;
  onRestore: () => void;
}) {
  const isArchived = staff.status === "archived";
  const isPending = staff.status === "pending";
  const isAdminish = staff.role === "admin" || staff.role === "superadmin";
  const canArchive = !isSelf && !isArchived && (isAdminish ? canArchiveAdmin : true);

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
        {isArchived ? `Archived ${formatDate(staff.archivedAt!)}` : staff.acceptedAt ? `Joined ${formatDate(staff.acceptedAt)}` : "—"}
      </div>
      {isArchived ? (
        canArchiveAdmin || !isAdminish ? (
          <Button size="sm" variant="ghost" onClick={onRestore}>
            <RotateCcw className="h-3.5 w-3.5" /> Restore
          </Button>
        ) : null
      ) : canArchive ? (
        <Button size="sm" variant="ghost" onClick={onArchive}>
          <Archive className="h-3.5 w-3.5" /> Archive
        </Button>
      ) : null}
    </li>
  );
}

function InviteDialog({
  onSubmit,
  onClose,
}: {
  onSubmit: (email: string, role: "admin" | "instructor") => void;
  onClose: () => void;
}) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"admin" | "instructor">("admin");

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="Invite staff"
      description="Token expires in 7 days. Inviting an instructor here only sends the invite — create their teaching profile from the Instructors page."
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (!email.trim()) return;
          onSubmit(email.trim(), role);
        }}
      >
        <div className="space-y-1.5">
          <Label>Role</Label>
          <div className="flex gap-2">
            {(["admin", "instructor"] as const).map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setRole(r)}
                className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium capitalize transition ${
                  role === r
                    ? "border-accent bg-accent/10 text-accent"
                    : "border-border bg-paper text-muted hover:bg-warm hover:text-ink"
                }`}
              >
                {r}
              </button>
            ))}
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="invite-email">Email</Label>
          <Input
            id="invite-email"
            type="email"
            required
            autoFocus
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="name@yogasadhana.sg"
          />
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit">Send invite</Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
