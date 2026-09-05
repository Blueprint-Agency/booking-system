"use client";
import { useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button, Dialog, DialogFooter, Input, Label } from "@/components/ui";
import { ApiError, type Api } from "@/lib/api";
import { inviteFirstAdmin, type PlatformTenant } from "@/lib/platform";

/**
 * The way out of a studio nobody can get into.
 *
 * A studio may be created with no first admin — one about to receive an archive
 * must be, because the import refuses a studio that already has staff — and such
 * a studio is created suspended, because a studio nobody can sign in to should
 * not be answering on its hostnames as though it were open. This is how it gets
 * a way in when the archive never arrives, or the operator changes their mind,
 * without being torn down and made again.
 *
 * Deliberately only the *first* admin. The backend refuses a studio that already
 * has staff, and this dialog is only offered for one that has none: inviting
 * staff into a working studio is that studio's own job, done from inside it with
 * its roles and location grants. A bootstrap that keeps working after the boot
 * is a standing back door into every studio on the platform.
 */
export interface InviteFirstAdminDialogProps {
  api: Api;
  tenant: PlatformTenant | null;
  onOpenChange: (open: boolean) => void;
  onInvited: () => void;
}

export function InviteFirstAdminDialog({
  api,
  tenant,
  onOpenChange,
  onInvited,
}: InviteFirstAdminDialogProps) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // A cancelled invite must not be waiting in the form for the next studio.
  // The parent keys this component on the studio it is open for, so closing it
  // remounts it empty — no effect, and no render in which the old address is
  // still on screen under a new studio's name.

  const canSubmit = Boolean(!submitting && tenant && email.trim());

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!canSubmit || !tenant) return;

    setSubmitting(true);
    try {
      const result = await inviteFirstAdmin(api, tenant.id, {
        admin_email: email.trim(),
        ...(name.trim() ? { admin_name: name.trim() } : {}),
      });
      toast.success(
        result.tenant.status === "active"
          ? `${result.admin.email} has been invited. ${tenant.name} is open.`
          : `${result.admin.email} has been invited to ${tenant.name}.`,
      );
      onInvited();
    } catch (err) {
      const code =
        err instanceof ApiError && err.body && typeof err.body === "object"
          ? (err.body as { error?: string }).error
          : undefined;
      toast.error(
        code === "tenant_already_has_staff"
          ? `${tenant.name} already has staff — invite the rest from inside the studio.`
          : code === "admin_email_invalid"
            ? "That email doesn’t look like an address."
            : `Could not invite an admin to ${tenant.name}.`,
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open={Boolean(tenant)}
      onOpenChange={onOpenChange}
      title="Invite the first admin"
      description={
        tenant
          ? `${tenant.name} has no staff, so nobody can sign in to it. Inviting an admin opens it.`
          : ""
      }
    >
      <form className="flex flex-col gap-4" onSubmit={submit}>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="first-admin-email">Email</Label>
          <Input
            id="first-admin-email"
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="owner@acmeyoga.com"
            autoFocus
            required
          />
          <p className="text-xs text-muted">
            They are invited to the studio’s portal and set everything else up from there.
          </p>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="first-admin-name">Name (optional)</Label>
          <Input
            id="first-admin-name"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="Jane Tan"
          />
        </div>

        <DialogFooter>
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" disabled={!canSubmit}>
            {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
            Send invitation
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
