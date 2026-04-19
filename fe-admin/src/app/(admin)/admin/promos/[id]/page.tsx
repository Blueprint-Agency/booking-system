"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import { useAdminState } from "@/lib/admin-state";
import { PageHeader, EmptyState, Button } from "@/components/ui";
import { PromoForm } from "@/components/domain/catalogue/promo-form";
import { disablePromo } from "@/lib/mutations/promos";

export default function EditPromoPage() {
  const { id } = useParams<{ id: string }>();
  const promo = useAdminState((s) => s.promos.find((p) => p.id === id));
  if (!promo) {
    return (
      <EmptyState
        title="Promo not found"
        cta={{ href: "/admin/promos", label: "Back to Promos" }}
      />
    );
  }
  return (
    <>
      <div className="mb-3 text-xs text-muted">
        <Link href="/admin/promos" className="inline-flex items-center gap-1 hover:text-ink">
          <ArrowLeft className="h-3 w-3" /> Promos
        </Link>
      </div>
      <PageHeader
        title={promo.code}
        description={`${promo.usedCount}/${promo.usageCap} used`}
        actions={
          promo.active ? (
            <Button
              variant="ghost"
              onClick={() => {
                const note = window.prompt("Why disable?");
                if (!note) return;
                try {
                  disablePromo(promo.id, note);
                  toast.success("Disabled");
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : "Failed");
                }
              }}
            >
              Disable
            </Button>
          ) : null
        }
      />
      <div className="mt-6">
        <PromoForm promo={promo} />
      </div>
    </>
  );
}
