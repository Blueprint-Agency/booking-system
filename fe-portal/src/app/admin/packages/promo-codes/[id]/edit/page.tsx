"use client";
import { useParams } from "next/navigation";
import { PromoCodeEditor } from "@/components/packages/promo-code-editor";

export default function EditPromoCodePage() {
  const params = useParams<{ id: string }>();
  return <PromoCodeEditor codeId={params.id} />;
}
