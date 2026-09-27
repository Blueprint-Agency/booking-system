"use client";
import { useEffect, useId, useState } from "react";
import { Loader2, Search } from "lucide-react";
import { Input } from "@/components/ui";
import { useWorkspace } from "@/lib/workspace-context";
import {
  KIND_LABEL,
  RULE_MODES,
  fetchRulePackages,
  groupPackages,
  packageRuleProblem,
  pickerPackages,
  togglePackage,
  type PackageRuleDraft,
  type RulePackage,
} from "@/lib/package-rule";

const MODE_HINT = {
  all: "Members can book with any of their class packages.",
  only: "Members can book only with a ticked package.",
  except: "Members can book with any package except a ticked one.",
} as const;

/**
 * "Accepted packages" on the scheduling forms: which class packages may pay for
 * this class — all of them, only the ticked ones, or all but the ticked ones.
 * The checklist groups the catalogue by kind, with archived packages (no longer
 * sold, still held by members) under their own heading, and filters as you type.
 */
export function PackageRuleField({
  role,
  value,
  onChange,
  named = [],
  hint,
  disabled = false,
}: {
  role: "admin" | "instructor";
  value: PackageRuleDraft;
  onChange: (next: PackageRuleDraft) => void;
  /** The packages the saved rule names, so a ticked one always shows even if the catalogue read missed it. */
  named?: readonly RulePackage[];
  hint?: string;
  disabled?: boolean;
}) {
  const uid = useId();
  const { packages, error } = useRulePackages(role);
  const [query, setQuery] = useState("");
  const all = packages ? pickerPackages(packages, named) : null;
  const groups = all ? groupPackages(all, query) : [];
  const problem = packageRuleProblem(value);
  const ticked = new Set(value.packageIds);

  return (
    <fieldset disabled={disabled} className="min-w-0 space-y-2 disabled:opacity-50">
      <legend className="mb-1.5 text-sm font-medium text-ink">Accepted packages</legend>
      <div
        role="radiogroup"
        aria-label="Accepted packages"
        className="grid grid-cols-3 gap-1 rounded-lg border border-border bg-card p-1"
      >
        {RULE_MODES.map((m) => {
          const on = value.mode === m.value;
          return (
            <button
              key={m.value}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => onChange({ ...value, mode: m.value })}
              className={`min-h-10 rounded-md px-1.5 py-1.5 text-sm font-medium leading-tight transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent sm:min-h-9 ${
                on ? "bg-accent text-white" : "text-muted hover:bg-paper hover:text-ink"
              }`}
            >
              {m.label}
            </button>
          );
        })}
      </div>
      <p className="text-xs text-muted">{MODE_HINT[value.mode]}</p>

      {value.mode !== "all" && (
        <div className="space-y-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <Input
              id={`${uid}-search`}
              type="search"
              aria-label="Search packages"
              placeholder="Search packages"
              autoComplete="off"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="pl-9"
            />
          </div>
          <div className="max-h-80 overflow-y-auto overscroll-contain rounded-lg border border-border">
            {error ? (
              <p className="px-3 py-4 text-sm text-error">{error}</p>
            ) : !all ? (
              <p className="flex items-center gap-2 px-3 py-4 text-sm text-muted">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading packages…
              </p>
            ) : all.length === 0 ? (
              <p className="px-3 py-4 text-sm text-muted">The studio has no class packages yet.</p>
            ) : groups.length === 0 ? (
              <p className="px-3 py-4 text-sm text-muted">No package matches &ldquo;{query.trim()}&rdquo;.</p>
            ) : (
              groups.map((g) => (
                <div key={g.key} role="group" aria-labelledby={`${uid}-${g.key}`}>
                  <h3
                    id={`${uid}-${g.key}`}
                    className="sticky top-0 z-10 border-b border-border bg-paper px-3 py-1.5 text-xs font-medium uppercase tracking-wide text-muted"
                  >
                    {g.label}
                  </h3>
                  <ul className="divide-y divide-border">
                    {g.packages.map((p) => (
                      <li key={p.id}>
                        <label className="flex min-h-11 cursor-pointer items-center gap-3 px-3 py-2 text-sm hover:bg-paper">
                          <input
                            type="checkbox"
                            className="h-5 w-5 shrink-0 accent-accent"
                            checked={ticked.has(p.id)}
                            onChange={() => onChange(togglePackage(value, p.id))}
                          />
                          <span className="min-w-0 flex-1 break-words text-ink">{p.name}</span>
                          {p.archived && (
                            <span className="shrink-0 text-xs text-muted">{KIND_LABEL[p.kind]}</span>
                          )}
                        </label>
                      </li>
                    ))}
                  </ul>
                </div>
              ))
            )}
          </div>
          <p className="text-xs text-muted" aria-live="polite">
            {ticked.size === 0 ? "Nothing ticked" : `${ticked.size} ticked`}
          </p>
        </div>
      )}

      {problem && (
        <p className="text-xs text-error" role="alert">
          {problem}
        </p>
      )}
      {hint && <p className="text-xs text-muted">{hint}</p>}
    </fieldset>
  );
}

/** The class packages a rule may name, or null until read. */
function useRulePackages(role: "admin" | "instructor") {
  const { api } = useWorkspace();
  const [packages, setPackages] = useState<RulePackage[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!api) return;
    let live = true;
    fetchRulePackages(api, role).then(
      (p) => live && setPackages(p),
      () => live && setError("Couldn't load the studio's packages. Reload to try again."),
    );
    return () => {
      live = false;
    };
  }, [api, role]);
  return { packages, error };
}
