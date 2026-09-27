// A class's **Package rule** (#323): which catalogue class packages may pay for
// it — every one (`all`, the default), only those named (`only`), or all but
// those named (`except`). Exact catalogue packages — Unlimited Plans, Credit
// Bundles and Trials, archived ones included, since members may still hold one.
// A Class Series carries a rule too and copies it onto every class it makes.
//
// The backend owns the rule (be/src/services/schedule/package-rules.ts): it
// refuses an empty "only these", folds an empty "all except" into "all", and
// decides which bookings a change cancels. This file words a rule, groups the
// picker's checklist, and builds the request body. Shapes mirror
// be/src/routes/portal/class-package-rule.ts.

import type { Api } from "@/lib/api";

export type PackageRuleMode = "all" | "only" | "except";
export type RulePackageKind = "credit_bundle" | "unlimited" | "trial";

/** A catalogue class package, as a rule names it and the picker lists it. */
export interface RulePackage {
  id: string;
  name: string;
  kind: RulePackageKind;
  /** No longer sold; still held by members who bought it. */
  archived: boolean;
}

/** A rule as the API returns it: its packages named, Unlimited → Credit Bundle → Trial, then by name. */
export interface NamedPackageRule {
  mode: PackageRuleMode;
  packages: RulePackage[];
}

/** A rule as the API takes it. Omitted from a create, the class accepts all; from an update, it is unchanged. */
export interface PackageRuleInput {
  mode: PackageRuleMode;
  package_ids: string[];
}

/** The rule field's state: the mode, and every package ticked (kept across mode switches). */
export interface PackageRuleDraft {
  mode: PackageRuleMode;
  packageIds: string[];
}

export const ACCEPTS_ALL_DRAFT: PackageRuleDraft = { mode: "all", packageIds: [] };

export const RULE_MODES: { value: PackageRuleMode; label: string }[] = [
  { value: "all", label: "All packages" },
  { value: "only", label: "Only these" },
  { value: "except", label: "All except" },
];

/* ------------------------------- Wording ------------------------------- */

/** "All packages" · "Only: A, B" · "All except: C". */
export function ruleSentence(rule: NamedPackageRule): string {
  const names = rule.packages.map((p) => p.name).join(", ");
  if (rule.mode === "only") return rule.packages.length > 0 ? `Only: ${names}` : "No packages";
  if (rule.mode === "except" && rule.packages.length > 0) return `All except: ${names}`;
  return "All packages";
}

/** "Accepts: Only: A, B" — the rule as a class's or series' details line reads it. */
export function acceptsLine(rule: NamedPackageRule): string {
  return `Accepts: ${ruleSentence(rule)}`;
}

/* -------------------------------- Draft -------------------------------- */

/** A saved rule as the field starts from. */
export function draftFromRule(rule: NamedPackageRule | null | undefined): PackageRuleDraft {
  if (!rule) return ACCEPTS_ALL_DRAFT;
  return { mode: rule.mode, packageIds: rule.packages.map((p) => p.id) };
}

/**
 * The draft as the API takes it. The ticked packages are kept while the mode is
 * "All packages" so switching back restores them, but none is sent with it.
 */
export function packageRuleBody(draft: PackageRuleDraft): PackageRuleInput {
  if (draft.mode === "all") return { mode: "all", package_ids: [] };
  return { mode: draft.mode, package_ids: [...new Set(draft.packageIds)].sort() };
}

/**
 * What the field says is wrong before anything is sent, or null. "Only these"
 * with nothing ticked would accept nobody — the server refuses it
 * (`package_rule_empty`); "All except" with nothing ticked is just "All".
 */
export function packageRuleProblem(draft: PackageRuleDraft): string | null {
  if (draft.mode === "only" && draft.packageIds.length === 0) return RULE_EMPTY_COPY;
  return null;
}

/** The rule in the form the server stores it: an empty "all except" is "all". */
function canonical(draft: PackageRuleDraft): PackageRuleInput {
  const body = packageRuleBody(draft);
  return body.mode === "except" && body.package_ids.length === 0 ? { mode: "all", package_ids: [] } : body;
}

/** Whether two drafts are the same rule — the editor previews a change only when the rule changed. */
export function sameRule(a: PackageRuleDraft, b: PackageRuleDraft): boolean {
  const x = canonical(a);
  const y = canonical(b);
  return x.mode === y.mode && x.package_ids.join() === y.package_ids.join();
}

/** Tick or untick one package. */
export function togglePackage(draft: PackageRuleDraft, id: string): PackageRuleDraft {
  const has = draft.packageIds.includes(id);
  return {
    ...draft,
    packageIds: has ? draft.packageIds.filter((p) => p !== id) : [...draft.packageIds, id],
  };
}

/* ------------------------------ Checklist ------------------------------ */

export type PackageGroupKey = RulePackageKind | "archived";

export interface PackageGroup {
  key: PackageGroupKey;
  label: string;
  packages: RulePackage[];
}

const KIND_ORDER: RulePackageKind[] = ["unlimited", "credit_bundle", "trial"];

const GROUP_LABEL: Record<PackageGroupKey, string> = {
  unlimited: "Unlimited Plans",
  credit_bundle: "Credit Bundles",
  trial: "Trials",
  archived: "Archived",
};

/** "Unlimited" · "Credit Bundle" · "Trial" — an archived package's kind, beside its name. */
export const KIND_LABEL: Record<RulePackageKind, string> = {
  unlimited: "Unlimited",
  credit_bundle: "Credit Bundle",
  trial: "Trial",
};

const byKindThenName = (a: RulePackage, b: RulePackage) =>
  KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || a.name.localeCompare(b.name);

/**
 * The picker's checklist: active packages under their kind — Unlimited Plans,
 * Credit Bundles, Trials — then every archived one under "Archived". `query`
 * keeps the packages whose name contains it, ignoring case; a group left empty
 * is dropped.
 */
export function groupPackages(packages: readonly RulePackage[], query = ""): PackageGroup[] {
  const q = query.trim().toLowerCase();
  const shown = q ? packages.filter((p) => p.name.toLowerCase().includes(q)) : [...packages];
  const groups: PackageGroup[] = KIND_ORDER.map((kind) => ({
    key: kind,
    label: GROUP_LABEL[kind],
    packages: shown.filter((p) => !p.archived && p.kind === kind).sort(byKindThenName),
  }));
  groups.push({
    key: "archived",
    label: GROUP_LABEL.archived,
    packages: shown.filter((p) => p.archived).sort(byKindThenName),
  });
  return groups.filter((g) => g.packages.length > 0);
}

/**
 * Every package the picker can offer: the catalogue, plus any package the saved
 * rule names that the catalogue read didn't return, so a ticked package is never
 * hidden from the staff member who can untick it.
 */
export function pickerPackages(
  catalogue: readonly RulePackage[],
  named: readonly RulePackage[] = [],
): RulePackage[] {
  const ids = new Set(catalogue.map((p) => p.id));
  return [...catalogue, ...named.filter((p) => !ids.has(p.id))];
}

/* ---------------------------- Catalogue read ---------------------------- */

interface ApiRulePackage {
  id: string;
  name: string;
  kind: RulePackageKind | "pt";
  status: "active" | "archived";
}

/** A catalogue row as the picker lists it. */
export function rulePackageFromApi(r: ApiRulePackage): RulePackage | null {
  if (r.kind !== "unlimited" && r.kind !== "credit_bundle" && r.kind !== "trial") return null;
  return { id: r.id, name: r.name, kind: r.kind, archived: r.status === "archived" };
}

/**
 * Every class package a rule may name, active and archived. Admins read the
 * catalogue; instructors read the names-only list their scheduling form needs.
 */
export async function fetchRulePackages(api: Api, role: "admin" | "instructor"): Promise<RulePackage[]> {
  const path =
    role === "admin" ? "/portal/admin/class-packages" : "/portal/instructor/catalog/class-packages";
  const res = await api.get<{ class_packages: ApiRulePackage[] }>(path);
  return res.class_packages.map(rulePackageFromApi).filter((p): p is RulePackage => p !== null);
}

/* --------------------------- Change and copy --------------------------- */

/** The field's hint with Repeat weekly on. */
export const SERIES_RULE_HINT = "Copied onto every class in the series.";

/** The field's hint on an existing series' panel, whose change never reaches the classes it already made. */
export const SERIES_EDIT_RULE_HINT =
  "Applies to classes this series adds from now on (Extend). Classes already made keep their own rule — change those on each class.";

/** The field's hint on the class editor, where a change can cancel bookings. */
export const EDIT_RULE_HINT =
  "Changing this cancels bookings paid by a package the class no longer accepts. You'll see how many before anything is saved.";

/** The confirm step before a rule change that cancels bookings. */
export function wouldCancelCopy(n: number) {
  const bookings = n === 1 ? "1 booking" : `${n} bookings`;
  return {
    title: `This will cancel ${bookings}`,
    body:
      n === 1
        ? "That member paid with a package this class will no longer accept. Their booking is cancelled, the credit goes back to their package, and they are emailed."
        : "Those members paid with a package this class will no longer accept. Their bookings are cancelled, their credits go back to their packages, and each is emailed.",
    keep: "Go back",
    confirm: `Cancel ${bookings} and save`,
  };
}

const RULE_EMPTY_COPY = "Tick at least one package, or choose All packages.";

/** Staff copy for the rule's own refusals, on any scheduling form. */
export const PACKAGE_RULE_ERROR_COPY: Record<string, string> = {
  package_rule_empty: `"Only these" needs at least one package. ${RULE_EMPTY_COPY}`,
  package_rule_invalid_package:
    "One of those packages is no longer one of the studio's class packages. Reload and pick again.",
};

/** A staff booking or waitlist promotion refused because the class accepts none of the member's packages. */
export const NOT_ACCEPTED_COPY = "This class doesn't accept any of this member's packages.";

/** The same, as a waitlist row's "Can't pay: …" reason. */
export const NOT_ACCEPTED_REASON = "this class doesn't accept their packages";
