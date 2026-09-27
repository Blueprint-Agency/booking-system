"use client";
import { useState } from "react";
import { AtSign, Pencil, RotateCcw, ShieldOff } from "lucide-react";
import { ResendInvitationButton } from "@/components/access/resend-invitation-button";
import { SessionsPanel } from "@/components/access/sessions-panel";
import { isPlaceholderEmail } from "@/lib/placeholder-email";
import {
  INSTRUCTOR_PERMISSIONS,
  PERMISSION_LABEL,
  knownPermissions,
  type InstructorPermission,
} from "@/lib/instructor-permissions";
import { PermissionSwitches } from "./permission-switches";
import { PendingEmailNotice, StaffEmailChange } from "./staff-email-change";
import {
  Badge,
  Button,
  Dialog,
  DialogFooter,
  Input,
  Label,
  Select,
  StatusBadge,
  Textarea,
} from "@/components/ui";

const GENDER_OPTIONS = [
  { value: "", label: "Not specified" },
  { value: "female", label: "Female" },
  { value: "male", label: "Male" },
  { value: "non_binary", label: "Non-binary" },
  { value: "prefer_not_to_say", label: "Prefer not to say" },
] as const;

const ROLE_LABEL = {
  admin: "Admin",
  instructor: "Instructor",
} as const;

const ROLE_TONE = {
  admin: "accent",
  instructor: "cyan",
} as const;

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

/** An address saved but not yet confirmed by the link mailed to it. */
export interface PendingEmail {
  email: string;
  sent_at: string;
  expires_at: string;
  /** The link no longer works; resend or revoke. */
  expired: boolean;
}

export interface StaffEditableFields {
  id: string;
  /** The address they sign in with. */
  email: string;
  /** A new address awaiting its confirmation link — shown as Unverified. */
  pending_email?: PendingEmail | null;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  address: string | null;
  gender: "female" | "male" | "non_binary" | "prefer_not_to_say" | null;
  bio: string | null;
  languages: string[] | null;
  role: "admin" | "instructor";
  status: "pending" | "active" | "archived";
  /** An Instructor's granted Instructor Permissions; null for an Admin. */
  permissions: string[] | null;
  /** Assigned Days — every staff member's, admins included. */
  annual_leave_days?: number;
  medical_leave_days?: number;
  study_leave_days?: number;
  /** This Leave Year's figures, for every staff member. Remaining is editable;
   *  Carried and Pool are shown as the context it is bounded by. */
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

export interface StaffEditPatch {
  first_name?: string;
  last_name?: string | null;
  phone?: string | null;
  address?: string | null;
  gender?: "female" | "male" | "non_binary" | "prefer_not_to_say" | null;
  bio?: string | null;
  languages?: string[];
  role?: StaffEditableFields["role"];
  /** The whole grant, replacing what is stored. An Instructor's only. */
  permissions?: InstructorPermission[];
  annual_leave_days?: number;
  medical_leave_days?: number;
  study_leave_days?: number;
  annual_remaining_days?: number;
  medical_remaining_days?: number;
  study_remaining_days?: number;
}

/** Assigned Days arrive together or not at all (one spread in the API
 *  serializer), and so do this Leave Year's figures. Absent means the API did
 *  not report them — never a stand-in number, because a fabricated 14 is
 *  indistinguishable from a real one once it is on screen. */
function hasAssigned(s: StaffEditableFields) {
  return (
    s.annual_leave_days !== undefined &&
    s.medical_leave_days !== undefined &&
    s.study_leave_days !== undefined
  );
}
function hasLeaveYear(s: StaffEditableFields) {
  return (
    s.annual_remaining_days !== undefined &&
    s.medical_remaining_days !== undefined &&
    s.study_remaining_days !== undefined
  );
}

/** What this viewer may do to the person's access, from the detail view (#119). */
export interface StaffAccessActions {
  canRevoke: boolean;
  canResend: boolean;
  /** Archive — how a staff member is blocked. Absent when not allowed. */
  onBlock?: () => void;
  onUnblock?: () => void;
}

export function StaffEditDialog({
  staff,
  canEdit,
  canChangeRole,
  canChangeEmail,
  isSelf,
  access,
  onSubmit,
  onPendingEmailChanged,
  onClose,
}: {
  staff: StaffEditableFields;
  /** Whether this viewer outranks the target. Computed by the page (same rule
   *  as the row's Edit button); a viewer without it still gets the full view. */
  canEdit: boolean;
  /** Admin viewing someone other than themselves. The last-admin guard is the
   *  server's; its refusal comes back as the save's error. */
  canChangeRole: boolean;
  /** An admin, for anyone not blocked — themselves included. */
  canChangeEmail: boolean;
  /** The viewer is looking at their own row. */
  isSelf: boolean;
  access: StaffAccessActions;
  /** Returns the PATCHed row (the API echoes the whole staff record, leave
   *  figures included) or null when the save failed. */
  onSubmit: (
    id: string,
    patch: StaffEditPatch,
  ) => Promise<StaffEditableFields | null>;
  /** An address was saved as Unverified, resent, or revoked (null). */
  onPendingEmailChanged: (staffId: string, pending: PendingEmail | null) => void;
  onClose: () => void;
}) {
  // The row the dialog trusts. Seeded from the list, then replaced by the PATCH
  // response so the view shows the server's figures rather than what was typed.
  const [current, setCurrent] = useState(staff);
  const [editing, setEditing] = useState(false);
  const [changingEmail, setChangingEmail] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function save(patch: StaffEditPatch) {
    setSubmitting(true);
    try {
      const updated = await onSubmit(current.id, patch);
      if (updated) {
        setCurrent(updated);
        setEditing(false);
      }
    } finally {
      setSubmitting(false);
    }
  }

  const name = [current.first_name, current.last_name].filter(Boolean).join(" ");
  const shownEmail = isPlaceholderEmail(current.email) ? "No email on file" : current.email;
  const emailChangeable = canChangeEmail && current.status !== "archived";

  function setPendingEmail(pending: PendingEmail | null) {
    setCurrent(c => ({ ...c, pending_email: pending }));
    onPendingEmailChanged(current.id, pending);
  }

  return (
    <Dialog
      open
      onOpenChange={o => !o && !submitting && onClose()}
      title={
        changingEmail
          ? "Change email"
          : editing
            ? "Edit staff profile"
            : name || shownEmail
      }
      description={
        changingEmail
          ? isSelf
            ? "The email you sign in with. Your password stays the same."
            : `The email ${name || "this staff member"} signs in with. Their password stays the same.`
          : editing
            ? `Update ${name || "this staff member"}'s profile details.`
            : shownEmail
      }
    >
      {changingEmail && (
        <StaffEmailChange
          staff={current}
          isSelf={isSelf}
          onCancel={() => setChangingEmail(false)}
          onSent={pending => {
            setChangingEmail(false);
            setPendingEmail(pending);
          }}
        />
      )}
      {/* Kept mounted while the email changes, so the edits typed so far survive
          the detour — hidden, not unmounted. */}
      <div className={changingEmail ? "hidden" : undefined}>
        {editing ? (
          <StaffProfileForm
            staff={current}
            canChangeRole={canChangeRole}
            onChangeEmail={emailChangeable ? () => setChangingEmail(true) : undefined}
            onPendingEmailChange={setPendingEmail}
            submitting={submitting}
            onSubmit={save}
            onCancel={() => setEditing(false)}
          />
        ) : (
          <StaffProfileView
            staff={current}
            canEdit={canEdit}
            access={access}
            onChangeEmail={emailChangeable ? () => setChangingEmail(true) : undefined}
            onPendingEmailChange={setPendingEmail}
            onEdit={() => setEditing(true)}
            onClose={onClose}
          />
        )}
      </div>
    </Dialog>
  );
}

/** The inline "Change" beside an email, in the view and the form alike. */
function ChangeEmailButton({ onClick }: { onClick: () => void }) {
  return (
    <Button type="button" size="sm" variant="ghost" className="shrink-0" onClick={onClick}>
      <AtSign className="h-3.5 w-3.5" /> Change
    </Button>
  );
}

// ---------------- View mode ----------------

function StaffProfileView({
  staff,
  canEdit,
  access,
  onChangeEmail,
  onPendingEmailChange,
  onEdit,
  onClose,
}: {
  staff: StaffEditableFields;
  canEdit: boolean;
  access: StaffAccessActions;
  onChangeEmail?: () => void;
  onPendingEmailChange: (pending: PendingEmail | null) => void;
  onEdit: () => void;
  onClose: () => void;
}) {
  const gender = staff.gender
    ? (GENDER_OPTIONS.find(o => o.value === staff.gender)?.label ?? staff.gender)
    : null;

  return (
    <div className="space-y-4">
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 border-y border-border py-4 text-sm">
        <Field label="First name">{staff.first_name}</Field>
        <Field label="Last name">{staff.last_name}</Field>
        <Field label="Email" full>
          <span className="flex items-center justify-between gap-2">
            <span className="min-w-0 break-all">
              {isPlaceholderEmail(staff.email) ? (
                <span className="text-muted">No email — imported without one</span>
              ) : (
                staff.email
              )}
            </span>
            {onChangeEmail && <ChangeEmailButton onClick={onChangeEmail} />}
          </span>
          {staff.pending_email && (
            <PendingEmailNotice
              staff={{ ...staff, pending_email: staff.pending_email }}
              canManage={!!onChangeEmail}
              onChange={onPendingEmailChange}
            />
          )}
        </Field>
        <Field label="Phone">{staff.phone}</Field>
        <Field label="Gender">{gender}</Field>
        <Field label="Address" full>
          {staff.address}
        </Field>
        <Field label="Languages" full>
          {staff.languages?.length ? staff.languages.join(", ") : null}
        </Field>
        <Field label="Bio" full>
          {staff.bio ? <span className="whitespace-pre-wrap">{staff.bio}</span> : null}
        </Field>
        <Field label="Role">
          <Badge tone={ROLE_TONE[staff.role]}>{ROLE_LABEL[staff.role]}</Badge>
        </Field>
        <Field label="Status">
          <StatusBadge
            status={staff.status}
            label={staff.status === "archived" ? "Archived" : undefined}
          />
        </Field>
        {staff.role === "instructor" && (
          <Field label="Permissions" full>
            <PermissionsSummary granted={knownPermissions(staff.permissions)} />
          </Field>
        )}
      </dl>

      {/* Every staff member takes leave, admins included. */}
      <LeaveView staff={staff} />

      <SessionsPanel
        path={`/portal/admin/staff/${staff.id}`}
        canRevoke={access.canRevoke}
        refreshKey={staff.status}
        actions={
          <>
            {access.canResend && <ResendInvitationButton staffId={staff.id} email={staff.email} />}
            {access.onBlock && (
              <Button size="sm" variant="ghost" onClick={access.onBlock}>
                <ShieldOff className="h-3.5 w-3.5" /> Block
              </Button>
            )}
            {access.onUnblock && (
              <Button size="sm" variant="ghost" onClick={access.onUnblock}>
                <RotateCcw className="h-3.5 w-3.5" /> Unblock
              </Button>
            )}
          </>
        }
      />

      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onClose}>
          Close
        </Button>
        {canEdit && (
          <Button type="button" onClick={onEdit}>
            <Pencil className="h-3.5 w-3.5" /> Edit
          </Button>
        )}
      </DialogFooter>
    </div>
  );
}

function Field({
  label,
  full,
  children,
}: {
  label: string;
  full?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div className={`flex flex-col gap-1 ${full ? "col-span-2" : ""}`}>
      <dt className="text-xs uppercase tracking-wider text-muted">{label}</dt>
      {/* An empty optional field reads as an em dash, never as blank space. */}
      <dd className="text-ink">{children || <span className="text-muted">—</span>}</dd>
    </div>
  );
}

/** Each switch by name, held or not — "none" would hide which ones are off. */
function PermissionsSummary({ granted }: { granted: InstructorPermission[] }) {
  return (
    <ul className="flex flex-wrap gap-1.5">
      {INSTRUCTOR_PERMISSIONS.map(key => (
        <li key={key}>
          {granted.includes(key) ? (
            <Badge tone="sage">{PERMISSION_LABEL[key]}</Badge>
          ) : (
            <Badge tone="neutral" className="text-muted">
              <span className="line-through">{PERMISSION_LABEL[key]}</span>
              <span className="sr-only"> (off)</span>
            </Badge>
          )}
        </li>
      ))}
    </ul>
  );
}

function LeaveView({ staff }: { staff: StaffEditableFields }) {
  const assigned = hasAssigned(staff);
  const year = hasLeaveYear(staff);

  return (
    <div className="space-y-3 rounded-lg border border-border bg-paper p-3">
      <h3 className="text-sm font-medium text-ink">Leave</h3>
      {!assigned && !year ? (
        <p className="text-xs text-muted">
          Leave figures unavailable — the API did not report them for this
          staff member.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-[1fr_auto_auto_auto] gap-x-4 gap-y-1.5 text-sm">
            <div />
            <div className="text-right text-xs uppercase tracking-wider text-muted">
              Annual
            </div>
            <div className="text-right text-xs uppercase tracking-wider text-muted">
              Medical
            </div>
            <div className="text-right text-xs uppercase tracking-wider text-muted">
              Study
            </div>
            <LeaveRow
              label="Assigned"
              annual={staff.annual_leave_days}
              medical={staff.medical_leave_days}
              study={staff.study_leave_days}
              strong
            />
            <LeaveRow
              label="Carried"
              annual={staff.annual_carried_days}
              medical={staff.medical_carried_days}
              study={staff.study_carried_days}
            />
            <LeaveRow
              label="Pool"
              annual={staff.annual_pool_days}
              medical={staff.medical_pool_days}
              study={staff.study_pool_days}
            />
            <LeaveRow
              label="Remaining"
              annual={staff.annual_remaining_days}
              medical={staff.medical_remaining_days}
              study={staff.study_remaining_days}
              strong
            />
          </div>
          <p className="text-xs text-muted">
            Days. The three types are separate — none eats into another, and only
            annual days carry into the next year.
          </p>
          {!year && (
            <p className="text-xs text-muted">
              This leave year&apos;s Carried, Pool and Remaining are unavailable.
            </p>
          )}
          {!assigned && (
            <p className="text-xs text-muted">Assigned days are unavailable.</p>
          )}
        </>
      )}
    </div>
  );
}

function LeaveRow({
  label,
  annual,
  medical,
  study,
  strong,
}: {
  label: string;
  annual?: number;
  medical?: number;
  study?: number;
  strong?: boolean;
}) {
  // `undefined` is "the API did not send it" and shows as an em dash; 0 and 14
  // are real figures and print as themselves.
  const cell = (v?: number) =>
    v === undefined ? <span className="text-muted">—</span> : v;
  return (
    <>
      <div className={strong ? "font-medium text-ink" : "text-muted"}>{label}</div>
      <div className={`text-right ${strong ? "font-medium text-ink" : "text-ink"}`}>
        {cell(annual)}
      </div>
      <div className={`text-right ${strong ? "font-medium text-ink" : "text-ink"}`}>
        {cell(medical)}
      </div>
      <div className={`text-right ${strong ? "font-medium text-ink" : "text-ink"}`}>
        {cell(study)}
      </div>
    </>
  );
}

// ---------------- Edit mode ----------------

function StaffProfileForm({
  staff,
  canChangeRole,
  onChangeEmail,
  onPendingEmailChange,
  submitting,
  onSubmit,
  onCancel,
}: {
  staff: StaffEditableFields;
  canChangeRole: boolean;
  /** The email is not a form field: it moves only through its own verified flow. */
  onChangeEmail?: () => void;
  onPendingEmailChange: (pending: PendingEmail | null) => void;
  submitting: boolean;
  onSubmit: (patch: StaffEditPatch) => void | Promise<void>;
  onCancel: () => void;
}) {
  const [role, setRole] = useState(staff.role);
  const storedPermissions = knownPermissions(staff.permissions);
  const [permissions, setPermissions] = useState(storedPermissions);
  // Switches only for an Instructor who stays one. A promotion takes none (they
  // are refused on an Admin); a demotion keeps the grant the backend holds —
  // all three, or what they had before — which this row, an Admin's, cannot show.
  const editsPermissions = canChangeRole && staff.role === "instructor" && role === "instructor";
  const permissionsChanged = permissions.join() !== storedPermissions.join();
  const [firstName, setFirstName] = useState(staff.first_name ?? "");
  const [lastName, setLastName] = useState(staff.last_name ?? "");
  const [phone, setPhone] = useState(staff.phone ?? "");
  const [address, setAddress] = useState(staff.address ?? "");
  const [gender, setGender] = useState(staff.gender ?? "");
  const [bio, setBio] = useState(staff.bio ?? "");
  const [languages, setLanguages] = useState((staff.languages ?? []).join(", "));
  // Every staff member has Assigned Days, admins included. The figures may
  // still be missing from the response, in which case there is nothing to
  // prefill and nothing to send: an input seeded with an invented default
  // would PATCH that invention back as an admin's choice.
  const assigned = hasAssigned(staff);
  const year = hasLeaveYear(staff);
  const [annualLeave, setAnnualLeave] = useState(staff.annual_leave_days ?? 0);
  const [medicalLeave, setMedicalLeave] = useState(staff.medical_leave_days ?? 0);
  const [studyLeave, setStudyLeave] = useState(staff.study_leave_days ?? 0);
  // This Leave Year's Remaining. Editable, and sent only when actually changed:
  // saving the figure back unchanged would back-solve a Pool against whatever is
  // Committed *now*, silently granting days if leave was filed since it loaded.
  const [annualRemaining, setAnnualRemaining] = useState(
    staff.annual_remaining_days ?? 0,
  );
  const [medicalRemaining, setMedicalRemaining] = useState(
    staff.medical_remaining_days ?? 0,
  );
  const [studyRemaining, setStudyRemaining] = useState(
    staff.study_remaining_days ?? 0,
  );
  // What the server will accept: Assigned + Carried, the same ceiling as
  // checkRemainingAdjustment. The saved figures on `staff` are last year's
  // Assigned, not the ones being typed above — raising Assigned raises the
  // ceiling on the next save, not this one.
  const annualCeiling = (staff.annual_leave_days ?? 0) + (staff.annual_carried_days ?? 0);
  const medicalCeiling = (staff.medical_leave_days ?? 0) + (staff.medical_carried_days ?? 0);
  // Study never carries, so this is the Assigned figure — 7 unless it was raised.
  const studyCeiling = (staff.study_leave_days ?? 0) + (staff.study_carried_days ?? 0);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!firstName.trim()) return;
    await onSubmit({
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
      // Only a real change: the server refuses `role` from anyone but an admin.
      ...(canChangeRole && role !== staff.role ? { role } : {}),
      ...(editsPermissions && permissionsChanged ? { permissions } : {}),
      // Every leave field goes only if the admin moved it off what the server
      // sent — never off a placeholder.
      ...(assigned && annualLeave !== staff.annual_leave_days
        ? { annual_leave_days: annualLeave }
        : {}),
      ...(assigned && medicalLeave !== staff.medical_leave_days
        ? { medical_leave_days: medicalLeave }
        : {}),
      ...(assigned && studyLeave !== staff.study_leave_days
        ? { study_leave_days: studyLeave }
        : {}),
      ...(year && annualRemaining !== staff.annual_remaining_days
        ? { annual_remaining_days: annualRemaining }
        : {}),
      ...(year && medicalRemaining !== staff.medical_remaining_days
        ? { medical_remaining_days: medicalRemaining }
        : {}),
      ...(year && studyRemaining !== staff.study_remaining_days
        ? { study_remaining_days: studyRemaining }
        : {}),
    });
  }

  return (
    <form className="space-y-4" onSubmit={handleSubmit}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
        <div className="flex items-center gap-2">
          <Input
            id="edit-email"
            className="min-w-0 flex-1"
            value={isPlaceholderEmail(staff.email) ? "No email on file" : staff.email}
            disabled
            readOnly
          />
          {onChangeEmail && <ChangeEmailButton onClick={onChangeEmail} />}
        </div>
        {staff.pending_email ? (
          <PendingEmailNotice
            staff={{ ...staff, pending_email: staff.pending_email }}
            canManage={!!onChangeEmail}
            onChange={onPendingEmailChange}
          />
        ) : (
          onChangeEmail && (
            <p className="text-xs text-muted">
              Changed separately — the new address confirms by link first.
            </p>
          )
        )}
      </div>

      {canChangeRole && (
        <div className="space-y-1.5">
          <Label htmlFor="edit-role">Role</Label>
          <Select
            id="edit-role"
            value={role}
            onChange={e => setRole(e.target.value as typeof role)}
          >
            {(["admin", "instructor"] as const).map(r => (
              <option key={r} value={r}>
                {ROLE_LABEL[r]}
              </option>
            ))}
          </Select>
          {staff.role === "admin" && role === "instructor" && (
            <p className="text-xs text-muted">
              Their instructor permissions can be set once this is saved.
            </p>
          )}
        </div>
      )}

      {editsPermissions && (
        <div className="space-y-2">
          <Label>Permissions</Label>
          <PermissionSwitches
            idPrefix="edit-perm"
            value={permissions}
            onChange={setPermissions}
            disabled={submitting}
          />
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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

      <div className="space-y-3 rounded-lg border border-border bg-paper p-3">
        <div>
          <h3 className="text-sm font-medium text-ink">Leave</h3>
          <p className="mt-0.5 text-xs text-muted">
            Assigned days apply from the next leave year. Remaining corrects
            this one. The three types are separate — none eats into another.
          </p>
        </div>
        {!assigned && !year ? (
          <p className="text-xs text-muted">
            Leave figures unavailable — the API did not report them for this
            staff member, so there is nothing to edit here.
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {assigned && (
              <>
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
                  <Label htmlFor="edit-study-leave">Assigned study (days)</Label>
                  <Input
                    id="edit-study-leave"
                    type="number"
                    min={0}
                    max={365}
                    value={studyLeave}
                    onChange={e => setStudyLeave(Number(e.target.value))}
                  />
                </div>
              </>
            )}
            {year && (
              <>
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
                    {poolNote(
                      staff.annual_pool_days,
                      staff.annual_carried_days,
                      annualCeiling,
                    )}
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
                    {poolNote(
                      staff.medical_pool_days,
                      staff.medical_carried_days,
                      medicalCeiling,
                    )}
                  </p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="edit-study-remaining">Remaining study (days)</Label>
                  <Input
                    id="edit-study-remaining"
                    type="number"
                    step={0.5}
                    min={0}
                    max={studyCeiling}
                    value={studyRemaining}
                    onChange={e => setStudyRemaining(Number(e.target.value))}
                  />
                  <p className="text-xs text-muted">
                    {poolNote(
                      staff.study_pool_days,
                      staff.study_carried_days,
                      studyCeiling,
                    )}
                  </p>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onCancel} disabled={submitting}>
          Cancel
        </Button>
        <Button type="submit" disabled={submitting || !firstName.trim()}>
          {submitting ? "Saving…" : "Save changes"}
        </Button>
      </DialogFooter>
    </form>
  );
}
