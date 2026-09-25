// The studio's switchboard (be-portal.md §feature-flags.ts). A flag nobody has
// set is off, so the screen lists every switch the portal knows about, not only
// the rows the backend returns. Shapes mirror
// be/src/routes/portal/admin/feature-flags.ts.

import type { Api } from "@/lib/api";

export interface FeatureFlagInfo {
  key: string;
  label: string;
  /** One line: what turning it on does. */
  description: string;
}

/** The studio switch for class waitlists (spec-waitlist.md §8). */
export const WAITLIST_FLAG = "waitlist_enabled";

export const FEATURE_FLAGS: FeatureFlagInfo[] = [
  {
    key: WAITLIST_FLAG,
    label: "Class waitlists",
    description:
      "Members can join a full class's waitlist and are booked in automatically when a seat opens; off, full classes just read Full.",
  },
];

export interface FeatureFlagState extends FeatureFlagInfo {
  enabled: boolean;
  updated_at: string | null;
}

/** Every known switch with its value; unset reads as off. */
export async function fetchFeatureFlags(api: Api): Promise<FeatureFlagState[]> {
  const res = await api.get<{ feature_flags: { key: string; enabled: boolean; updated_at: string }[] }>(
    "/portal/admin/feature-flags",
  );
  const byKey = new Map(res.feature_flags.map((f) => [f.key, f]));
  return FEATURE_FLAGS.map((info) => ({
    ...info,
    enabled: byKey.get(info.key)?.enabled ?? false,
    updated_at: byKey.get(info.key)?.updated_at ?? null,
  }));
}

export async function setFeatureFlag(api: Api, key: string, enabled: boolean): Promise<void> {
  await api.patch(`/portal/admin/feature-flags/${key}`, { enabled });
}
