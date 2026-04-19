"use client";

import { PageHeader } from "@/components/ui";
import { PromoForm } from "@/components/domain/catalogue/promo-form";

export default function NewPromoPage() {
  return (
    <>
      <PageHeader title="New promo" description="Discount code with date window and caps." />
      <div className="mt-6">
        <PromoForm />
      </div>
    </>
  );
}
