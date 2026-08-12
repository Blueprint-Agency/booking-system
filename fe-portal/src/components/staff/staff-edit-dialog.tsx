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

/** The context an admin is editing Remaining in, read-only: this year's Pool,
 *  how much of it was carried in, and the ceiling the server bounds against.
 *  The ceiling is Assigned + Carried and NOT the Pool — a previous adjustment
 *  moves the Pool, and bounding against it would leave a mistyped figure
 *  impossible to put back until January. */
function poolNote(pool?: number, carried?: number, ceiling?: number) {
  if (pool === undefined) return "";
  const composition = carried ? `, incl. ${carried} carried in` : "";
  return `Pool ${pool} days${composition} — remaining can be set up to ${ceiling ?? pool}, their assigned plus carried days.`;
}

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
  role: "superadmin" | "admin" | "instructor";
  /** Assigned Days — sent by the API for instructors only. */
  annual_leave_days?: number;
  medical_leave_days?: number;
  /** This Leave Year's figures — instructors only. Remaining is editable;
   *  Carried and Pool are shown as the context it is bounded by. */
  annual_carried_days?: number;
  annual_pool_days?: number;
  annual_remaining_days?: number;
  medical_carried_days?: number;
  medical_pool_days?: number;
  medical_remaining_days?: number;
}

export interface StaffEditPatch {
  first_name?: string;
  last_name?: string | null;
  phone?: string | null;
  address?: string | null;
  gender?: "female" | "male" | "non_binary" | "prefer_not_to_say" | null;
  bio?: string | null;
  languages?: string[];
  annual_leave_days?: number;
  medical_leave_days?: number;
  annual_remaining_days?: number;
  medical_remaining_days?: number;
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
  // Assigned Days exist for instructors only — the dialog is shared with the
  // Admin tab, where a leave figure would mean nothing.
  const isInstructor = staff.role === "instructor";
  const [annualLeave, setAnnualLeave] = useState(staff.annual_leave_days ?? 14);
  const [medicalLeave, setMedicalLeave] = useState(staff.medical_leave_days ?? 14);
  // This Leave Year's Remaining. Editable, and sent only when actually changed:
  // saving the figure back unchanged would back-solve a Pool against whatever is
  // Committed *now*, silently granting days if leave was filed since it loaded.
  const [annualRemaining, setAnnualRemaining] = useState(staff.annual_remaining_days ?? 0);
  const [medicalRemaining, setMedicalRemaining] = useState(staff.medical_remaining_days ?? 0);
  // What the server will accept: Assigned + Carried, the same ceiling as
  // checkRemainingAdjustment. The saved figures on `staff` are last year's
  // Assigned, not the ones being typed above — raising Assigned raises the
  // ceiling on the next save, not this one.
  const annualCeiling = (staff.annual_leave_days ?? 0) + (staff.annual_carried_days ?? 0);
  const medicalCeiling = (staff.medical_leave_days ?? 0) + (staff.medical_carried_days ?? 0);
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
        ...(isInstructor
          ? { annual_leave_days: annualLeave, medical_leave_days: medicalLeave }
          : {}),
        ...(isInstructor && annualRemaining !== staff.annual_remaining_days
          ? { annual_remaining_days: annualRemaining }
          : {}),
        ...(isInstructor && medicalRemaining !== staff.medical_remaining_days
          ? { medical_remaining_days: medicalRemaining }
          : {}),
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

        {isInstructor && (
          <div className="space-y-3 rounded-lg border border-border bg-paper p-3">
            <div>
              <h3 className="text-sm font-medium text-ink">Leave</h3>
              <p className="mt-0.5 text-xs text-muted">
                Assigned days apply from the next leave year. Remaining corrects
                this one. The two types are separate — medical never eats into
                annual.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="edit-annual-leave">Assigned annual (days)</Label>
                <Input
                  id="edit-annual-leave"
                  type="number"
                  min={0}
                  max={365}
                  value={annualLeave}
                  onChange={e => setAnnualLeave(Number(e.target.value))}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="edit-medical-leave">Assigned medical (days)</Label>
                <Input
                  id="edit-medical-leave"
                  type="number"
                  min={0}
                  max={365}
                  value={medicalLeave}
                  onChange={e => setMedicalLeave(Number(e.target.value))}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="edit-annual-remaining">Remaining annual (days)</Label>
                <Input
                  id="edit-annual-remaining"
                  type="number"
                  step={0.5}
                  min={0}
                  max={annualCeiling}
                  value={annualRemaining}
                  onChange={e => setAnnualRemaining(Number(e.target.value))}
                />
                <p className="text-xs text-muted">
                  {poolNote(staff.annual_pool_days, staff.annual_carried_days, annualCeiling)}
                </p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="edit-medical-remaining">Remaining medical (days)</Label>
                <Input
                  id="edit-medical-remaining"
                  type="number"
                  step={0.5}
                  min={0}
                  max={medicalCeiling}
                  value={medicalRemaining}
                  onChange={e => setMedicalRemaining(Number(e.target.value))}
                />
                <p className="text-xs text-muted">
                  {poolNote(staff.medical_pool_days, staff.medical_carried_days, medicalCeiling)}
                </p>
              </div>
            </div>
          </div>
        )}

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
