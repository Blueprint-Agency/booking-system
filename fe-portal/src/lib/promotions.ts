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
