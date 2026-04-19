"use client";

import { setState, getAdminState } from "@/lib/admin-state";
import { appendAuditEntry } from "@/lib/audit";
import type { Promo } from "@/types";

function newId(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export interface PromoInput {
  tenantId: string;
  code: string;
  discountType: Promo["discountType"];
  discountValue: number;
  startsAt: string;
  endsAt: string;
  usageCap: number;
  perUserCap: number;
  productIds: string[];
  active: boolean;
}

export function createPromo(input: PromoInput): Promo {
  const code = input.code.trim().toUpperCase();
  if (!code) throw new Error("Code required");
  const conflict = getAdminState().promos.find(
    (p) => p.tenantId === input.tenantId && p.code === code,
  );
  if (conflict) throw new Error("Code already in use");

  const promo: Promo = {
    id: newId("prm"),
    tenantId: input.tenantId,
    code,
    discountType: input.discountType,
    discountValue: input.discountValue,
    startsAt: input.startsAt,
    endsAt: input.endsAt,
    usageCap: input.usageCap,
    usedCount: 0,
    perUserCap: input.perUserCap,
    productIds: input.productIds,
    active: input.active,
  };
  setState((s) => ({ ...s, promos: [promo, ...s.promos] }));
  appendAuditEntry({
    action: "promo.create",
    entityType: "Promo",
    entityId: promo.id,
    before: null,
    after: promo,
    note: `Created promo ${promo.code}`,
  });
  return promo;
}

export interface UpdatePromoInput extends Partial<Omit<PromoInput, "tenantId">> {
  id: string;
}

export function updatePromo(input: UpdatePromoInput): Promo {
  let beforeRef: Promo | null = null;
  let afterRef: Promo | null = null;
  setState((s) => {
    const p = s.promos.find((x) => x.id === input.id);
    if (!p) return s;
    beforeRef = p;
    const next: Promo = { ...p, ...input };
    if (input.code !== undefined) next.code = input.code.toUpperCase();
    afterRef = next;
    return { ...s, promos: s.promos.map((x) => (x.id === p.id ? next : x)) };
  });
  const before = beforeRef as Promo | null;
  const after = afterRef as Promo | null;
  if (!before || !after) throw new Error("Promo not found");
  appendAuditEntry({
    action: "promo.create",
    entityType: "Promo",
    entityId: input.id,
    before,
    after,
    note: `Updated promo ${after.code}`,
  });
  return after;
}

export function disablePromo(id: string, note: string): Promo {
  let beforeRef: Promo | null = null;
  let afterRef: Promo | null = null;
  setState((s) => {
    const p = s.promos.find((x) => x.id === id);
    if (!p) return s;
    beforeRef = p;
    const next: Promo = { ...p, active: false };
    afterRef = next;
    return { ...s, promos: s.promos.map((x) => (x.id === id ? next : x)) };
  });
  const before = beforeRef as Promo | null;
  const after = afterRef as Promo | null;
  if (!before || !after) throw new Error("Promo not found");
  appendAuditEntry({
    action: "promo.disable",
    entityType: "Promo",
    entityId: id,
    before,
    after,
    note: note || "Disabled promo",
  });
  return after;
}
