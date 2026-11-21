/**
 * The trial tick on a package form (a class or a PT package). A trial is a
 * package of its type sold once to a member new to that type in its Entity.
 * It is fixed once the package is made, so an edit shows it and locks it.
 */
export function TrialCheckbox({
  id,
  checked,
  onChange,
  locked,
  hint,
}: {
  id: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** Editing a saved package: the tick shows what it is and cannot change. */
  locked: boolean;
  hint: string;
}) {
  return (
    <label
      htmlFor={id}
      className={`flex items-start gap-3 rounded-lg border border-border bg-paper px-3 py-2.5 transition ${
        locked ? "cursor-default" : "cursor-pointer hover:bg-warm"
      }`}
    >
      <input
        id={id}
        type="checkbox"
        checked={checked}
        disabled={locked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-4 w-4 rounded border-border text-accent focus:ring-accent disabled:opacity-60"
      />
      <span className="min-w-0">
        <span className="block text-sm font-medium text-ink">Trial</span>
        <span className="mt-0.5 block text-xs text-muted">
          {hint}
          {locked && " Set when the package is created; it can't be changed after."}
        </span>
      </span>
    </label>
  );
}
