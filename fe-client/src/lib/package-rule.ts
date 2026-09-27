/**
 * A class's Package rule: which of the studio's catalogue packages may pay for
 * it (be/CONTEXT.md § Package rule). `all` is the default; `only` names the
 * packages it takes, `except` the ones it refuses.
 *
 * The rule is the backend's to enforce — selection classifies a package the
 * class does not take as `not_accepted`. What lives here is how the member app
 * states it: one short sentence on the class detail. Pure, so it can be tested
 * against the payload that produces it.
 */

export type PackageRuleMode = "all" | "only" | "except";

/** A package the rule names, as `package_rule.packages` states it. */
export interface RulePackage {
  id: string;
  name: string;
  kind: "credit_bundle" | "unlimited" | "trial";
  /** No longer sold. Still named: members may hold one. */
  archived: boolean;
}

/** `package_rule` on `GET /public/classes/:id` and `GET /me/classes/:id`. */
export interface ApiPackageRule {
  mode: PackageRuleMode;
  packages: RulePackage[];
}

/** The hint on a class row whose rule is not `all` (the card's `restricted`). */
export const RESTRICTED_HINT = "Some packages";

/**
 * "All packages", "Only: A, B", "All except: C". An `except` naming nothing
 * takes everything; an `only` naming nothing takes nothing.
 */
export function ruleSentence(rule: ApiPackageRule): string {
  const names = rule.packages.map((p) => p.name).join(", ");
  switch (rule.mode) {
    case "only":
      return names ? `Only: ${names}` : "No packages";
    case "except":
      return names ? `All except: ${names}` : "All packages";
    default:
      return "All packages";
  }
}
