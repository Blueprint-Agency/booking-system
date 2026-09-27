/**
 * A class's **Package rule** — which catalogue class packages may pay for it
 * (be/CONTEXT.md § Package rule): every one (`all`, the default and what every
 * existing and imported class has), only those named (`only`), or all but those
 * named (`except`). Exact catalogue packages — Unlimited Plans, Credit Bundles
 * and Trials, archived ones included so a package migrated members still hold
 * can be named.
 *
 * The mode lives on the class or Class Series row; the packages it names are
 * rows of `class_rule_packages` / `class_series_rule_packages`. A series carries
 * a rule as a template and copies it onto every class it makes, extends
 * included — exactly as the Cancellation Window is copied. Editing one class's
 * rule never reaches back to its series or the other classes.
 *
 * This module reads, validates, names and writes rules. What a rule does to a
 * booking is `services/packages/selection` (`not_accepted`); what changing one
 * does to the bookings a class already has is `./package-rule-change`.
 */
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { db } from '../../db'
import {
  classes,
  classRulePackages,
  classSeries,
  classSeriesRulePackages,
} from '../../db/schema/schedule'
import { classPackages } from '../../db/schema/packages'
import type { PackageRuleMode } from '../../db/enums'
import { ACCEPTS_ALL, type PackageRule } from '../packages/selection'
import { BadRequestError } from '../../shared/errors'
import type { Tx } from './roster'

export { ACCEPTS_ALL, type PackageRule } from '../packages/selection'

type Reader = Tx | typeof db

/** A package a rule names, as staff and members are shown it. */
export interface RulePackage {
  id: string
  name: string
  kind: 'credit_bundle' | 'unlimited' | 'trial'
  /** Archived in the catalogue: no longer sold, still held by members who bought it. */
  archived: boolean
}

/** A rule with its packages named, for the portal and the member's class detail. */
export interface NamedPackageRule {
  mode: PackageRuleMode
  packages: RulePackage[]
}

/**
 * A rule as staff sent it, checked and put in its stored form. `only` with
 * nothing in it would accept nothing, and is refused; `except` with nothing in
 * it is `all`. Every package must be one of this studio's class packages —
 * archived ones included — so a PT or corporate package, another studio's, or
 * an id that names nothing is refused by name.
 */
export async function validateRule(reader: Reader, tenantId: string, input: PackageRule): Promise<PackageRule> {
  if (input.mode === 'all') return ACCEPTS_ALL
  const ids = [...new Set(input.packageIds)].sort()
  if (ids.length === 0) {
    if (input.mode === 'only') throw new BadRequestError('package_rule_empty')
    return ACCEPTS_ALL
  }
  const found = new Set(
    (
      await reader
        .select({ id: classPackages.id })
        .from(classPackages)
        .where(and(eq(classPackages.tenantId, tenantId), inArray(classPackages.id, ids), isNull(classPackages.deletedAt)))
    ).map(r => r.id),
  )
  const unknown = ids.filter(id => !found.has(id))
  if (unknown.length > 0) throw new BadRequestError('package_rule_invalid_package', { package_ids: unknown })
  return { mode: input.mode, packageIds: ids }
}

/** A class's rule. A class on `all` costs no query. */
export async function readClassRule(
  reader: Reader,
  tenantId: string,
  cls: { id: string; packageRuleMode: PackageRuleMode },
): Promise<PackageRule> {
  if (cls.packageRuleMode === 'all') return ACCEPTS_ALL
  const rows = await reader
    .select({ id: classRulePackages.classPackageId })
    .from(classRulePackages)
    .where(and(eq(classRulePackages.tenantId, tenantId), eq(classRulePackages.classId, cls.id)))
  return { mode: cls.packageRuleMode, packageIds: rows.map(r => r.id).sort() }
}

/** A series' rule — the template its classes are made with. */
export async function readSeriesRule(
  reader: Reader,
  tenantId: string,
  series: { id: string; packageRuleMode: PackageRuleMode },
): Promise<PackageRule> {
  if (series.packageRuleMode === 'all') return ACCEPTS_ALL
  const rows = await reader
    .select({ id: classSeriesRulePackages.classPackageId })
    .from(classSeriesRulePackages)
    .where(and(eq(classSeriesRulePackages.tenantId, tenantId), eq(classSeriesRulePackages.seriesId, series.id)))
  return { mode: series.packageRuleMode, packageIds: rows.map(r => r.id).sort() }
}

const KIND_ORDER: Record<RulePackage['kind'], number> = { unlimited: 0, credit_bundle: 1, trial: 2 }

/** The rule with each package's name, kind and whether it is archived: by kind, then name. */
export async function nameRule(reader: Reader, tenantId: string, rule: PackageRule): Promise<NamedPackageRule> {
  if (rule.packageIds.length === 0) return { mode: rule.mode, packages: [] }
  const rows = await reader
    .select({ id: classPackages.id, name: classPackages.name, kind: classPackages.kind, status: classPackages.status })
    .from(classPackages)
    .where(and(eq(classPackages.tenantId, tenantId), inArray(classPackages.id, [...rule.packageIds])))
  return {
    mode: rule.mode,
    packages: rows
      .map(r => ({ id: r.id, name: r.name, kind: r.kind, archived: r.status === 'archived' }))
      .sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.name.localeCompare(b.name)),
  }
}

/** A class's rule with its packages named, read in one call. */
export async function namedClassRule(
  tenantId: string,
  cls: { id: string; packageRuleMode: PackageRuleMode },
): Promise<NamedPackageRule> {
  return nameRule(db, tenantId, await readClassRule(db, tenantId, cls))
}

/** A named rule on the wire, as every route that shows one sends it. */
export function namedRuleJson(rule: NamedPackageRule) {
  return {
    mode: rule.mode,
    packages: rule.packages.map(p => ({ id: p.id, name: p.name, kind: p.kind, archived: p.archived })),
  }
}

/**
 * Set these classes' rule — one class being edited, or every class a series has
 * just made. Replaces whatever list they had.
 */
export async function writeClassRule(tx: Tx, tenantId: string, classIds: string[], rule: PackageRule): Promise<void> {
  if (classIds.length === 0) return
  await tx
    .update(classes)
    .set({ packageRuleMode: rule.mode })
    .where(and(eq(classes.tenantId, tenantId), inArray(classes.id, classIds)))
  await tx
    .delete(classRulePackages)
    .where(and(eq(classRulePackages.tenantId, tenantId), inArray(classRulePackages.classId, classIds)))
  if (rule.packageIds.length === 0) return
  await tx
    .insert(classRulePackages)
    .values(classIds.flatMap(classId => rule.packageIds.map(classPackageId => ({ tenantId, classId, classPackageId }))))
}

/** Set a series' rule: the one every class it creates from now on is given. */
export async function writeSeriesRule(tx: Tx, tenantId: string, seriesId: string, rule: PackageRule): Promise<void> {
  await tx
    .update(classSeries)
    .set({ packageRuleMode: rule.mode })
    .where(and(eq(classSeries.tenantId, tenantId), eq(classSeries.id, seriesId)))
  await tx
    .delete(classSeriesRulePackages)
    .where(and(eq(classSeriesRulePackages.tenantId, tenantId), eq(classSeriesRulePackages.seriesId, seriesId)))
  if (rule.packageIds.length === 0) return
  await tx
    .insert(classSeriesRulePackages)
    .values(rule.packageIds.map(classPackageId => ({ tenantId, seriesId, classPackageId })))
}
