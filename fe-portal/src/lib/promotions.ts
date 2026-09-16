import type { Promotion } from "@/types";

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
