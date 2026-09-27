"use client";
import {
  INSTRUCTOR_PERMISSIONS,
  PERMISSION_HINT,
  PERMISSION_LABEL,
  type InstructorPermission,
} from "@/lib/instructor-permissions";

/**
 * The three Instructor Permission switches (be/docs/adr/0012). Controlled: the
 * caller holds the grant and decides when it is saved. `compact` is the staff
 * row's one-line form; otherwise each switch carries its hint, for a dialog.
 */
export function PermissionSwitches({
  value,
  onChange,
  disabled,
  compact,
  idPrefix,
}: {
  value: readonly InstructorPermission[];
  onChange: (next: InstructorPermission[]) => void;
  disabled?: boolean;
  compact?: boolean;
  idPrefix: string;
}) {
  function toggle(key: InstructorPermission) {
    const next = value.includes(key) ? value.filter(k => k !== key) : [...value, key];
    // Canonical order, so a saved grant reads the same however it was clicked.
    onChange(INSTRUCTOR_PERMISSIONS.filter(k => next.includes(k)));
  }

  return (
    <div className={compact ? "flex flex-wrap gap-x-4 gap-y-1" : "space-y-2"}>
      {INSTRUCTOR_PERMISSIONS.map(key => {
        const id = `${idPrefix}-${key}`;
        return (
          <div key={key} className="flex items-start gap-2.5">
            <PermissionSwitch
              id={id}
              checked={value.includes(key)}
              disabled={disabled}
              onToggle={() => toggle(key)}
              hintId={compact ? undefined : `${id}-hint`}
            />
            <div className="min-w-0">
              <label htmlFor={id} className="text-sm text-ink">
                {PERMISSION_LABEL[key]}
              </label>
              {!compact && (
                <p id={`${id}-hint`} className="text-xs text-muted">
                  {PERMISSION_HINT[key]}
                </p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function PermissionSwitch({
  id,
  checked,
  disabled,
  onToggle,
  hintId,
}: {
  id: string;
  checked: boolean;
  disabled?: boolean;
  onToggle: () => void;
  hintId?: string;
}) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-describedby={hintId}
      disabled={disabled}
      onClick={onToggle}
      // The before: box widens the hit area to thumb size without growing the switch.
      className={`relative mt-0.5 inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors before:absolute before:-inset-2 before:content-[''] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50 ${
        checked ? "bg-accent" : "bg-border"
      }`}
    >
      <span
        className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${
          checked ? "translate-x-4" : "translate-x-0.5"
        }`}
      />
    </button>
  );
}
