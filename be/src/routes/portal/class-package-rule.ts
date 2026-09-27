import { z } from 'zod'
import { namedClassRule, namedRuleJson, type PackageRule } from '../../services/schedule/package-rules'
import type { PackageRuleMode } from '../../db/enums'

/**
 * A class's Package rule on the wire, shared by the admin and instructor
 * schedule routes and the series routes (be/CONTEXT.md § Package rule).
 * Formatting and shape only: what a rule means and what is refused is
 * `services/schedule/package-rules`.
 */

/** `{ mode, package_ids }`. `all` needs no list; `only` with an empty one is refused by the service. */
export const packageRuleSchema = z.object({
  mode: z.enum(['all', 'only', 'except']),
  package_ids: z.array(z.string().uuid()).default([]),
})

export const toPackageRule = (b: z.infer<typeof packageRuleSchema>): PackageRule => ({
  mode: b.mode,
  packageIds: b.package_ids,
})

/** A class row's `package_rule`, its packages named. */
export async function classPackageRuleJson(tenantId: string, cls: { id: string; packageRuleMode: PackageRuleMode }) {
  return namedRuleJson(await namedClassRule(tenantId, cls))
}
