import type { Promotion } from "@/types";

type Priced = { priceSgd: number; promotions: Promotion[] };

export function effectivePrice(base: number, promo: Promotion): number {
  if (promo.mode === "percent" && promo.percent !== null) {
    return Math.round(base * (1 - promo.percent / 100));
  }
  if (promo.mode === "price" && promo.priceSgd !== null) {
    return promo.priceSgd;
  }
  return base;
}

/**
 * Returns the set of promotion ids whose date range overlaps at least one other
 * promotion. Ranges are inclusive on both ends (`endsAt` is stored as 23:59:59),
 * so two promos conflict when `a.startsAt <= b.endsAt && b.startsAt <= a.endsAt`.
 * A package may carry many promos over time, but no two may be active on the same
 * day — otherwise the effective price for that day is ambiguous.
 */
export function overlappingPromotionIds(promotions: Promotion[]): Set<string> {
  const conflicts = new Set<string>();
  for (let i = 0; i < promotions.length; i++) {
    for (let j = i + 1; j < promotions.length; j++) {
      const a = promotions[i];
      const b = promotions[j];
      if (a.startsAt <= b.endsAt && b.startsAt <= a.endsAt) {
        conflicts.add(a.id);
        conflicts.add(b.id);
      }
    }
  }
  return conflicts;
}

export function hasPromotionOverlap(promotions: Promotion[]): boolean {
  return overlappingPromotionIds(promotions).size > 0;
}

export function getActivePromotion(pkg: Priced, now: Date = new Date()): Promotion | null {
  const nowIso = now.toISOString();
  const active = pkg.promotions.filter((p) => p.startsAt <= nowIso && nowIso <= p.endsAt);
  if (active.length === 0) return null;
  if (active.length === 1) return active[0];
  return [...active].sort((a, b) => {
    const ea = effectivePrice(pkg.priceSgd, a);
    const eb = effectivePrice(pkg.priceSgd, b);
    if (ea !== eb) return ea - eb;
    return a.startsAt.localeCompare(b.startsAt);
  })[0];
}

export function getEffectivePrice(pkg: Priced, now: Date = new Date()) {
  const promo = getActivePromotion(pkg, now);
  return {
    price: promo ? effectivePrice(pkg.priceSgd, promo) : pkg.priceSgd,
    original: pkg.priceSgd,
    promo,
  };
}

/**
 * Wire shape used by `/portal/admin/{class-packages,pt-packages,workshops}` for
 * promotions. Mirrors the BE `serializePromotion` output (read) and the
 * `promotionInputSchema` accepted body (write). The `id` field is a server-side
 * uuid when present; locally-created promos use a synthetic `promo-…` id which
 * we strip before sending so the BE creates a fresh row.
 */
export interface ApiPromotion {
  id: string;
  label: string;
  kind: "percent" | "special_price";
  percent_off: number | null;
  special_price_sgd: string | null;
  starts_at: string;
  ends_at: string;
}

const SERVER_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function promotionFromApi(p: ApiPromotion): Promotion {
  return {
    id: p.id,
    label: p.label,
    mode: p.kind === "percent" ? "percent" : "price",
    percent: p.kind === "percent" ? p.percent_off : null,
    priceSgd:
      p.kind === "special_price" && p.special_price_sgd !== null
        ? Number(p.special_price_sgd)
        : null,
    startsAt:
      typeof p.starts_at === "string" ? p.starts_at : new Date(p.starts_at).toISOString(),
    endsAt:
      typeof p.ends_at === "string" ? p.ends_at : new Date(p.ends_at).toISOString(),
  };
}

export function promotionToApiPayload(p: Promotion): {
  id: string | null;
  label: string;
  kind: "percent" | "special_price";
  percent_off: number | null;
  special_price_sgd: string | null;
  starts_at: string;
  ends_at: string;
} {
  const isServerId = SERVER_UUID.test(p.id);
  const kind: "percent" | "special_price" =
    p.mode === "percent" ? "percent" : "special_price";
  return {
    id: isServerId ? p.id : null,
    label: p.label.trim(),
    kind,
    percent_off: kind === "percent" ? p.percent ?? null : null,
    special_price_sgd:
      kind === "special_price" && p.priceSgd !== null ? p.priceSgd.toFixed(2) : null,
    starts_at: p.startsAt,
    ends_at: p.endsAt,
  };
}
