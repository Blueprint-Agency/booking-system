"use client";

import { useState } from "react";
import type { Product } from "@/types";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { ProductRow } from "@/components/catalog/product-row";
import { ProductForm } from "@/components/catalog/product-form";
import { useAdminState } from "@/lib/mock-state";

export default function PrivatePacksPage() {
  const state = useAdminState();
  const [editing, setEditing] = useState<Product | null>(null);
  const [creating, setCreating] = useState(false);

  const products = state.products.filter((p) => p.type === "private-pack");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Private session packs"
        description="PT credit bundles. Credits redeem on private sessions."
        actions={<Button onClick={() => setCreating(true)}>New pack</Button>}
      />

      <div className="overflow-hidden rounded-xl border border-ink/10 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-paper/60 text-left text-[11px] font-semibold uppercase tracking-wide text-ink/60">
            <tr>
              <th className="px-4 py-2">Name</th>
              <th className="px-4 py-2">Type</th>
              <th className="px-4 py-2">Price</th>
              <th className="px-4 py-2">Sessions</th>
              <th className="px-4 py-2">Status</th>
              <th className="px-4 py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {products.map((p) => (
              <ProductRow key={p.id} product={p} onEdit={setEditing} />
            ))}
          </tbody>
        </table>
        {products.length === 0 && (
          <div className="p-8 text-center text-sm text-ink/50">No private packs yet.</div>
        )}
      </div>

      {creating && (
        <ProductForm open={creating} onClose={() => setCreating(false)} defaultType="private-pack" />
      )}
      {editing && (
        <ProductForm initial={editing} open={!!editing} onClose={() => setEditing(null)} />
      )}
    </div>
  );
}
