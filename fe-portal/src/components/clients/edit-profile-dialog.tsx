"use client";
import { useState } from "react";
import { Button, Dialog, DialogFooter, Input, Label } from "@/components/ui";

export type ClientGender = "female" | "male" | "non_binary" | "prefer_not_to_say";

const GENDERS: { value: ClientGender; label: string }[] = [
  { value: "female", label: "Female" },
  { value: "male", label: "Male" },
  { value: "non_binary", label: "Non-binary" },
  { value: "prefer_not_to_say", label: "Prefer not to say" },
];

export type ProfileEdit = { name?: string; phone?: string; gender?: ClientGender | null };

/**
 * An admin corrects a member's name, gender and phone (#281) — the call to the
 * front desk about a misspelt name or a new number, in one save.
 *
 * Pre-filled with what the studio holds, and only what the admin changed is
 * sent, so the audit trail records just that. The same limits as adding a
 * member: a name of up to 160 characters and a phone of up to 40, neither blank.
 */
export function EditProfileDialog({
  current,
  onSave,
  onClose,
}: {
  current: { name: string; phone: string; gender: ClientGender | null };
  onSave: (edit: ProfileEdit) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(current.name);
  const [phone, setPhone] = useState(current.phone);
  const [gender, setGender] = useState<ClientGender | "">(current.gender ?? "");

  const edit: ProfileEdit = {};
  // Against the stored value trimmed too, so opening the dialog on a name with
  // stray spaces is not already a change.
  if (name.trim() !== current.name.trim()) edit.name = name.trim();
  if (phone.trim() !== current.phone.trim()) edit.phone = phone.trim();
  if ((gender || null) !== current.gender) edit.gender = gender || null;

  const blank = name.trim() === "" || phone.trim() === "";
  const ready = !blank && Object.keys(edit).length > 0;

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={`Edit profile — ${current.name}`}
      description="Changes are recorded in the audit trail with what they were before."
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (!ready) return;
          onSave(edit);
        }}
      >
        <div className="space-y-1.5">
          <Label htmlFor="profile-name">Name</Label>
          <Input
            id="profile-name"
            required
            autoFocus
            maxLength={160}
            autoComplete="off"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          {name.trim() === "" && <p className="text-xs text-error">A name is required.</p>}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="profile-phone">Phone</Label>
          <Input
            id="profile-phone"
            type="tel"
            required
            maxLength={40}
            autoComplete="off"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
          {phone.trim() === "" && <p className="text-xs text-error">A phone number is required.</p>}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="profile-gender">Gender</Label>
          <select
            id="profile-gender"
            value={gender}
            onChange={(e) => setGender(e.target.value as ClientGender | "")}
            className="h-10 w-full rounded-md border border-border bg-card px-3 py-2 text-sm"
          >
            <option value="">Not set</option>
            {GENDERS.map((g) => (
              <option key={g.value} value={g.value}>
                {g.label}
              </option>
            ))}
          </select>
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={!ready}>
            Save profile
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
