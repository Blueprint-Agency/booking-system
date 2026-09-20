"use client";
import { useState } from "react";
import { Button, Dialog, DialogFooter, Input, Label } from "@/components/ui";

/**
 * An admin changes a member's email (#176) — for a member imported with a
 * placeholder address, or one who has since moved.
 *
 * The dialog states the two consequences the form cannot show: the member signs
 * in at the new address from now on, keeping every package and booking, and
 * their current sessions end, so a device left signed in stops acting as them.
 * Nothing is emailed to either address in this version.
 */
export function ChangeEmailDialog({
  memberName,
  currentEmail,
  onSave,
  onClose,
}: {
  memberName: string;
  currentEmail: string;
  onSave: (email: string) => void;
  onClose: () => void;
}) {
  const [email, setEmail] = useState("");
  const typed = email.trim().toLowerCase();
  const ready = typed !== "" && typed !== currentEmail.trim().toLowerCase();

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={`Change email — ${memberName}`}
      description="The member signs in with the new address and keeps every package and booking. Their current sessions end, and the old address no longer reaches them here. Unless they already have an account at the new address, their first sign-in there mails them a link to set a password. Nothing is sent by this change itself."
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (!ready) return;
          onSave(typed);
        }}
      >
        <div className="space-y-1.5">
          <Label htmlFor="new-email">New email</Label>
          <Input
            id="new-email"
            type="email"
            required
            autoFocus
            autoComplete="off"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={currentEmail}
          />
          <p className="text-xs text-muted">
            Currently {currentEmail}. An address another member of this studio
            already uses is refused.
          </p>
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={!ready}>
            Change email
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
