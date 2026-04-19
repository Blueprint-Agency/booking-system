"use client";

import { PageHeader } from "@/components/ui";
import { ProductForm } from "@/components/domain/catalogue/product-form";

export default function NewProductPage() {
  return (
    <>
      <PageHeader title="New product" description="Drop-in, package, membership or VIP." />
      <div className="mt-6">
        <ProductForm />
      </div>
    </>
  );
}
