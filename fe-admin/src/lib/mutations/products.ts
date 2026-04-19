"use client";

import { setState } from "@/lib/admin-state";
import { appendAuditEntry } from "@/lib/audit";
import type { Product } from "@/types";

function newId(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export interface CreateProductInput {
  tenantId: string;
  name: string;
  type: Product["type"];
  creditType: Product["creditType"];
  priceCents: number;
  sessionCount: number | null;
  expiryDays: number | null;
  sessionsPerMonth: number | null;
  description: string;
  active: boolean;
  priceByInstructorId?: Record<string, number>;
  crossLocation?: boolean;
}

export function createProduct(input: CreateProductInput): Product {
  const product: Product = {
    id: newId("prd"),
    tenantId: input.tenantId,
    name: input.name.trim(),
    type: input.type,
    creditType: input.creditType,
    priceCents: input.priceCents,
    sessionCount: input.sessionCount,
    expiryDays: input.expiryDays,
    sessionsPerMonth: input.sessionsPerMonth,
    description: input.description.trim(),
    active: input.active,
    priceByInstructorId: input.priceByInstructorId,
    crossLocation: input.crossLocation ?? true,
  };
  setState((s) => ({ ...s, products: [product, ...s.products] }));
  appendAuditEntry({
    action: "product.create",
    entityType: "Product",
    entityId: product.id,
    before: null,
    after: product,
    note: `Created product ${product.name}`,
  });
  return product;
}

export interface UpdateProductInput
  extends Partial<Omit<CreateProductInput, "tenantId">> {
  id: string;
}

export function updateProduct(input: UpdateProductInput): Product {
  let beforeRef: Product | null = null;
  let afterRef: Product | null = null;
  setState((s) => {
    const p = s.products.find((x) => x.id === input.id);
    if (!p) return s;
    beforeRef = p;
    const next: Product = { ...p, ...input };
    afterRef = next;
    return { ...s, products: s.products.map((x) => (x.id === p.id ? next : x)) };
  });
  const before = beforeRef as Product | null;
  const after = afterRef as Product | null;
  if (!before || !after) throw new Error("Product not found");
  appendAuditEntry({
    action: "product.update",
    entityType: "Product",
    entityId: input.id,
    before,
    after,
    note: `Updated product ${after.name}`,
  });
  return after;
}

export function archiveProduct(id: string, note: string): Product {
  let beforeRef: Product | null = null;
  let afterRef: Product | null = null;
  setState((s) => {
    const p = s.products.find((x) => x.id === id);
    if (!p) return s;
    beforeRef = p;
    const next: Product = { ...p, active: false };
    afterRef = next;
    return { ...s, products: s.products.map((x) => (x.id === id ? next : x)) };
  });
  const before = beforeRef as Product | null;
  const after = afterRef as Product | null;
  if (!before || !after) throw new Error("Product not found");
  appendAuditEntry({
    action: "product.archive",
    entityType: "Product",
    entityId: id,
    before,
    after,
    note: note || "Archived product",
  });
  return after;
}
