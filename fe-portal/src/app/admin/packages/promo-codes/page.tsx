"use client";
/**
 * Promo Codes list — a page of its own alongside the packages, NOT nested
 * inside a package editor. A Promotion nests because it belongs to one product;
 * a Promo Code crosses products and cannot.
 */
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Plus, Loader2 } from "lucide-react";
import { Button, PageHeader, Badge, EmptyState } from "@/components/ui";
import { useWorkspace } from "@/lib/workspace-context";
import { ApiError } from "@/lib/api";
import { formatSgd, formatDate } from "@/lib/formatters";
import type { ApiPromoCode } from "@/components/packages/promo-code-editor";

const NEW_HREF = "/admin/packages/promo-codes/new";

function moneyOff(c: ApiPromoCode) {
  if (c.kind === "percent") return `${c.percent_off}% off`;
  return `${formatSgd(Number(c.amount_off_sgd ?? 0))} off`;
}

function claimed(c: ApiPromoCode) {
  if (c.max_redemptions == null) return `${c.redemption_count} redeemed`;
  return `${c.redemption_count} of ${c.max_redemptions} claimed`;
}

export default function PromoCodesListPage() {
  const { api } = useWorkspace();
  const [codes, setCodes] = useState<ApiPromoCode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!api) return;
    setLoading(true);
    setError(null);
    try {
      const res = await api.get<{ promo_codes: ApiPromoCode[] }>("/portal/admin/promo-codes");
      setCodes(res.promo_codes);
    } catch (err) {
      setError(err instanceof ApiError ? `HTTP ${err.status}` : "Network error");
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader
        title="Promo Codes"
        description="Codes a member types at checkout. One code reaches across products, may carry a total cap, and is always capped at one use per member."
        actions={
          <Link href={NEW_HREF}>
            <Button>
              <Plus className="h-4 w-4" /> New Promo Code
            </Button>
          </Link>
        }
      />

      {loading ? (
        <div className="flex h-32 items-center justify-center gap-2 text-sm text-muted">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : error ? (
        <div className="rounded-xl border border-error/30 bg-error/5 p-6 text-center">
          <p className="text-sm text-error">Failed to load: {error}</p>
          <Button size="sm" variant="ghost" onClick={load} className="mt-2">
            Retry
          </Button>
        </div>
      ) : codes.length === 0 ? (
        <EmptyState
          title="No Promo Codes yet"
          description="Create one to run a campaign. Nothing is published until you hand the code out."
          cta={{ href: NEW_HREF, label: "New Promo Code" }}
        />
      ) : (
        <ul className="divide-y divide-border rounded-xl border border-border bg-card shadow-soft">
          {codes.map((c) => (
            <li key={c.id}>
              <Link
                href={`/admin/packages/promo-codes/${c.id}/edit`}
                className="flex items-center justify-between gap-4 px-4 py-3 hover:bg-paper"
              >
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-ink">{c.code}</div>
                  <div className="mt-1 text-xs text-muted">
                    {c.label} · {c.applies_to_all ? "Everything" : `${c.products.length} product${c.products.length === 1 ? "" : "s"}`}
                    {c.expires_at ? ` · Expires ${formatDate(c.expires_at)}` : " · Never expires"}
                  </div>
                </div>
                <div className="hidden sm:block min-w-[110px] text-right text-sm text-ink">
                  {moneyOff(c)}
                </div>
                <div className="hidden md:block min-w-[140px] text-right text-xs text-muted">
                  {claimed(c)}
                </div>
                <div className="min-w-[80px] text-right">
                  {c.status === "archived" ? (
                    <Badge tone="neutral">Archived</Badge>
                  ) : (
                    <Badge tone="sage">Active</Badge>
                  )}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
