"use client";
import { useState } from "react";
import {
  Button,
  Dialog,
  DialogFooter,
  Input,
  Label,
  Select,
  Textarea,
} from "@/components/ui";

const GENDER_OPTIONS = [
  { value: "", label: "Not specified" },
  { value: "female", label: "Female" },
  { value: "male", label: "Male" },
  { value: "non_binary", label: "Non-binary" },
  { value: "prefer_not_to_say", label: "Prefer not to say" },
] as const;

export interface StaffEditableFields {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  address: string | null;
  gender: "female" | "male" | "non_binary" | "prefer_not_to_say" | null;
  bio: string | null;
  languages: string[] | null;
}

export interface StaffEditPatch {
  first_name?: string;
  last_name?: string | null;
  phone?: string | null;
  address?: string | null;
  gender?: "female" | "male" | "non_binary" | "prefer_not_to_say" | null;
  bio?: string | null;
  languages?: string[];
}

export function StaffEditDialog({
  staff,
  onSubmit,
  onClose,
}: {
  staff: StaffEditableFields;
  onSubmit: (id: string, patch: StaffEditPatch) => void | Promise<void>;
  onClose: () => void;
}) {
  const [firstName, setFirstName] = useState(staff.first_name ?? "");
  const [lastName, setLastName] = useState(staff.last_name ?? "");
  const [phone, setPhone] = useState(staff.phone ?? "");
  const [address, setAddress] = useState(staff.address ?? "");
  const [gender, setGender] = useState(staff.gender ?? "");
  const [bio, setBio] = useState(staff.bio ?? "");
  const [languages, setLanguages] = useState((staff.languages ?? []).join(", "));
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!firstName.trim()) return;
    setSubmitting(true);
    try {
      await onSubmit(staff.id, {
        first_name: firstName.trim(),
        last_name: lastName.trim() || null,
        phone: phone.trim() || null,
        address: address.trim() || null,
        gender: gender ? (gender as StaffEditPatch["gender"]) : null,
        bio: bio.trim() || null,
        languages: languages
          .split(",")
          .map(l => l.trim())
          .filter(Boolean),
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open
      onOpenChange={o => !o && !submitting && onClose()}
      title="Edit staff profile"
      description={`Update ${staff.email}'s profile details.`}
    >
      <form className="space-y-4" onSubmit={handleSubmit}>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="edit-first-name">First name</Label>
            <Input
              id="edit-first-name"
              required
              autoFocus
              value={firstName}
              onChange={e => setFirstName(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="edit-last-name">Last name</Label>
            <Input
              id="edit-last-name"
              value={lastName}
              onChange={e => setLastName(e.target.value)}
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="edit-email">Email</Label>
          <Input id="edit-email" value={staff.email} disabled readOnly />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="edit-phone">Phone</Label>
            <Input
              id="edit-phone"
              value={phone}
              onChange={e => setPhone(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="edit-gender">Gender</Label>
            <Select
              id="edit-gender"
              value={gender}
              onChange={e => setGender(e.target.value as typeof gender)}
            >
              {GENDER_OPTIONS.map(opt => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </Select>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="edit-address">Address</Label>
          <Input
            id="edit-address"
            value={address}
            onChange={e => setAddress(e.target.value)}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="edit-languages">Languages</Label>
          <Input
            id="edit-languages"
            placeholder="English, Mandarin, Malay"
            value={languages}
            onChange={e => setLanguages(e.target.value)}
          />
          <p className="text-xs text-muted">Comma-separated.</p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="edit-bio">Bio</Label>
          <Textarea
            id="edit-bio"
            rows={4}
            value={bio}
            onChange={e => setBio(e.target.value)}
          />
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button type="submit" disabled={submitting || !firstName.trim()}>
            {submitting ? "Saving…" : "Save changes"}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
