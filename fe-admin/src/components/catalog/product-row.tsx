"use client";

import type { Product } from "@/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toggleProductActive } from "@/lib/mock-state";

export function ProductRow({
  product,
  onEdit,
}: {
  product: Product;
  onEdit: (p: Product) => void;
}) {
  return (
    <tr className="border-t border-ink/5">
      <td className="px-4 py-3">
        <div className="font-medium text-ink">{product.name}</div>
        {product.description && (
          <div className="text-xs text-ink/50 line-clamp-1">{product.description}</div>
        )}
      </td>
      <td className="px-4 py-3">
        <Badge tone="neutral">{product.type}</Badge>
      </td>
      <td className="px-4 py-3 font-mono text-ink/70">S${product.price}</td>
      <td className="px-4 py-3 font-mono text-ink/70">
        {product.sessionCount ?? product.sessionsPerMonth ?? "—"}
      </td>
      <td className="px-4 py-3">
        {product.active ? (
          <Badge tone="sage">active</Badge>
        ) : (
          <Badge tone="neutral">archived</Badge>
        )}
      </td>
      <td className="px-4 py-3 text-right">
        <Button variant="ghost" size="sm" onClick={() => toggleProductActive(product.id)}>
          {product.active ? "Archive" : "Restore"}
        </Button>
        <Button variant="ghost" size="sm" onClick={() => onEdit(product)}>
          Edit
        </Button>
      </td>
    </tr>
  );
}
