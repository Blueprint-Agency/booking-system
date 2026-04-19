"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { useAdminState } from "@/lib/admin-state";
import { PageHeader, EmptyState } from "@/components/ui";
import { ProductForm } from "@/components/domain/catalogue/product-form";

export default function EditProductPage() {
  const { id } = useParams<{ id: string }>();
  const product = useAdminState((s) => s.products.find((p) => p.id === id));
  if (!product) {
    return (
      <EmptyState
        title="Package not found"
        description="This package doesn't exist."
        cta={{ href: "/admin/packages", label: "Back to Packages" }}
      />
    );
  }
  return (
    <>
      <div className="mb-3 text-xs text-muted">
        <Link href="/admin/packages" className="inline-flex items-center gap-1 hover:text-ink">
          <ArrowLeft className="h-3 w-3" /> Packages
        </Link>
      </div>
      <PageHeader title={product.name} description={`${product.type} · ${product.creditType}`} />
      <div className="mt-6">
        <ProductForm product={product} />
      </div>
    </>
  );
}
