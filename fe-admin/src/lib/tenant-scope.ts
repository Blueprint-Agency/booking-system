"use client";
/**
 * Single-studio mode: tenant scoping is a no-op.
 *
 * These helpers used to filter rows by `tenantId` for the multi-tenant SaaS.
 * Now every row belongs to the single Yoga Sadhana studio, so they're identity
 * passthroughs. Kept here so the ~70 historic callsites don't all need
 * touching at once — they'll be cleaned up incrementally as each surface is
 * revisited.
 *
 * @deprecated Will be removed once all callsites are migrated.
 */

export function withTenant<T>(rows: T[], _tenantId?: string | null): T[] {
  return rows;
}

export function useWithTenant<T>(rows: T[]): T[] {
  return rows;
}
