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
  all: "Members can book with any of their group class packages.",
  only: "Members can book only with the packages you tick.",
  except: "Members can book with any package except the ones you tick.",
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
      {/* A plain radio list, each choice with its own line of meaning, so
          the three can be compared before one is picked. */}
      <div className="divide-y divide-border rounded-lg border border-border">
        {RULE_MODES.map((m) => (
          <label
            key={m.value}
            className="flex min-h-11 cursor-pointer items-start gap-3 px-3 py-2.5 hover:bg-paper"
          >
            <input
              type="radio"
              name={`${uid}-mode`}
              className="mt-0.5 h-4 w-4 shrink-0 accent-accent"
              checked={value.mode === m.value}
              onChange={() => onChange({ ...value, mode: m.value })}
            />
            <span className="min-w-0">
              <span className="block text-sm font-medium text-ink">{m.label}</span>
              <span className="block text-xs text-muted">{MODE_HINT[m.value]}</span>
            </span>
          </label>
        ))}
      </div>

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
