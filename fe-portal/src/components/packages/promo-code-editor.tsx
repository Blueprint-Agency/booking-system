"use client";
/**
 * Create or edit one Promo Code (spec-pre-launch-batch.md §9–§11).
 *
 * A Promo Code crosses products, so its editor is NOT nested inside a package
 * editor the way a Promotion's is — a Promotion belongs to exactly one product
 * and a Promo Code cannot.
 *
 * Once a member has redeemed the code, the code text and the money off stop
 * being editable: changing either would rewrite terms someone has accepted.
 * Label, expiry, cap and product list stay editable for the code's whole life.
 */
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, Check } from "lucide-react";
import { Button, PageHeader, Input, Label, Badge } from "@/components/ui";
import { useWorkspace } from "@/lib/workspace-context";
import { ApiError } from "@/lib/api";

type ProductType = "class_package" | "pt_package" | "workshop";

interface ApiProductRef {
  product_type: ProductType;
  product_id: string;
}

interface ApiScopableProduct extends ApiProductRef {
  name: string;
}

export interface ApiPromoCode {
  id: string;
  code: string;
  label: string;
  kind: "percent" | "amount";
  percent_off: number | null;
  amount_off_sgd: string | null;
  max_redemptions: number | null;
  expires_at: string | null;
  applies_to_all: boolean;
  status: "active" | "archived";
  products: ApiProductRef[];
  redemption_count: number;
  terms_frozen: boolean;
}

const PRODUCT_GROUPS: { type: ProductType; heading: string }[] = [
  { type: "class_package", heading: "Class packages" },
  { type: "pt_package", heading: "Private session packages" },
  { type: "workshop", heading: "Workshops" },
];

const LIST_HREF = "/admin/packages/promo-codes";

function refKey(p: ApiProductRef) {
  return `${p.product_type}:${p.product_id}`;
}

/** `expires_at` is a timestamp; the admin picks a day, and it runs to the end of it. */
function toDayInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function fromDayInput(day: string): string | null {
  if (!day) return null;
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d, 23, 59, 59, 999).toISOString();
}

function apiMessage(err: unknown): string {
  if (err instanceof ApiError) {
    const body = err.body as { error?: string; message?: string } | null;
    return body?.message ?? body?.error ?? `Failed (HTTP ${err.status})`;
  }
  return "Network error";
}

export function PromoCodeEditor({ codeId }: { codeId?: string }) {
  const router = useRouter();
  const { api } = useWorkspace();
  const isNew = !codeId;

  const [row, setRow] = useState<ApiPromoCode | null>(null);
  const [catalogue, setCatalogue] = useState<ApiScopableProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [customCode, setCustomCode] = useState("");
  const [label, setLabel] = useState("");
  const [kind, setKind] = useState<"percent" | "amount">("amount");
  const [percentOff, setPercentOff] = useState("");
  const [amountOffSgd, setAmountOffSgd] = useState("");
  const [maxRedemptions, setMaxRedemptions] = useState("");
  const [expiresOn, setExpiresOn] = useState("");
  const [appliesToAll, setAppliesToAll] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [archiveBusy, setArchiveBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!api) return;
    setLoading(true);
    setLoadError(null);
    try {
      const products = await api.get<{ products: ApiScopableProduct[] }>(
        "/portal/admin/promo-codes/products",
      );
      setCatalogue(products.products);
      if (codeId) {
        const res = await api.get<ApiPromoCode>(`/portal/admin/promo-codes/${codeId}`);
        setRow(res);
        setCustomCode(res.code);
        setLabel(res.label);
        setKind(res.kind);
        setPercentOff(res.percent_off == null ? "" : String(res.percent_off));
        setAmountOffSgd(res.amount_off_sgd ?? "");
        setMaxRedemptions(res.max_redemptions == null ? "" : String(res.max_redemptions));
        setExpiresOn(toDayInput(res.expires_at));
        setAppliesToAll(res.applies_to_all);
        setSelected(new Set(res.products.map(refKey)));
      }
    } catch (err) {
      setLoadError(apiMessage(err));
    } finally {
      setLoading(false);
    }
  }, [api, codeId]);

  useEffect(() => {
    void load();
  }, [load]);

  const frozen = row?.terms_frozen ?? false;

  const productRefs = useMemo(
    () =>
      catalogue
        .filter((p) => selected.has(refKey(p)))
        .map((p) => ({ product_type: p.product_type, product_id: p.product_id })),
    [catalogue, selected],
  );

  const toggleProduct = (p: ApiScopableProduct) => {
    setSelected((prev) => {
      const next = new Set(prev);
      const key = refKey(p);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!api) return;
    setSaveError(null);
    setSaving(true);
    try {
      if (isNew) {
        const created = await api.post<ApiPromoCode>("/portal/admin/promo-codes", {
          // Left blank, the backend generates one from the unambiguous alphabet.
          ...(customCode.trim() ? { code: customCode.trim().toUpperCase() } : {}),
          label: label.trim(),
          kind,
          percent_off: kind === "percent" ? Number(percentOff) : null,
          amount_off_sgd: kind === "amount" ? amountOffSgd : null,
          max_redemptions: maxRedemptions ? Number(maxRedemptions) : null,
          expires_at: fromDayInput(expiresOn),
          applies_to_all: appliesToAll,
          products: appliesToAll ? [] : productRefs,
        });
        router.push(`${LIST_HREF}/${created.id}/edit`);
        return;
      }
      const res = await api.patch<ApiPromoCode>(`/portal/admin/promo-codes/${codeId}`, {
        label: label.trim(),
        max_redemptions: maxRedemptions ? Number(maxRedemptions) : null,
        expires_at: fromDayInput(expiresOn),
        applies_to_all: appliesToAll,
        products: appliesToAll ? [] : productRefs,
        // Terms are omitted entirely once someone has redeemed the code — the
        // backend refuses them, and there is nothing to send while they match.
        ...(frozen
          ? {}
          : {
              code: customCode.trim().toUpperCase(),
              kind,
              percent_off: kind === "percent" ? Number(percentOff) : null,
              amount_off_sgd: kind === "amount" ? amountOffSgd : null,
            }),
      });
      setRow(res);
      setSavedAt(Date.now());
    } catch (err) {
      setSaveError(apiMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const onToggleArchive = async () => {
    if (!api || !row) return;
    setActionError(null);
    setArchiveBusy(true);
    try {
      const verb = row.status === "archived" ? "unarchive" : "archive";
      setRow(await api.post<ApiPromoCode>(`/portal/admin/promo-codes/${row.id}/${verb}`));
    } catch (err) {
      setActionError(apiMessage(err));
    } finally {
      setArchiveBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="mx-auto flex h-32 max-w-2xl items-center justify-center gap-2 text-sm text-muted">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading…
      </div>
    );
  }

  if (loadError || (!isNew && !row)) {
    return (
      <div className="mx-auto max-w-2xl rounded-xl border border-error/30 bg-error/5 p-6 text-center">
        <p className="text-sm text-error">Failed to load: {loadError ?? "Not found"}</p>
        <Button size="sm" variant="ghost" onClick={load} className="mt-2">
          Retry
        </Button>
      </div>
    );
  }

  const valueValid =
    kind === "percent" ? Number(percentOff) >= 1 && Number(percentOff) <= 99 : Number(amountOffSgd) > 0;
  const scopeValid = appliesToAll || productRefs.length > 0;
  const canSubmit =
    label.trim().length > 0 &&
    scopeValid &&
    (frozen || valueValid) &&
    (isNew || frozen || customCode.trim().length >= 3);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <PageHeader
        title={isNew ? "New Promo Code" : row!.code}
        description={
          isNew
            ? "A code the member types at checkout. It reaches across products and is always capped at one use per member."
            : "Label, expiry, cap and products stay editable. To stop this code, archive it."
        }
        actions={
          <div className="flex items-center gap-2">
            {!isNew &&
              (row!.status === "archived" ? (
                <Badge tone="neutral">Archived</Badge>
              ) : (
                <Badge tone="sage">Active</Badge>
              ))}
            {!isNew && (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={onToggleArchive}
                disabled={archiveBusy}
              >
                {archiveBusy && <Loader2 className="h-4 w-4 animate-spin" />}
                {row!.status === "archived" ? "Unarchive" : "Archive"}
              </Button>
            )}
            <Link href={LIST_HREF}>
              <Button variant="ghost" size="sm">
                Back
              </Button>
            </Link>
          </div>
        }
      />

      {actionError && (
        <div className="rounded-lg border border-error/30 bg-error/5 px-3 py-2 text-sm text-error">
          {actionError}
        </div>
      )}

      {frozen && (
        <div className="rounded-lg border border-border bg-paper px-3 py-2 text-sm text-muted">
          {row!.redemption_count} member
          {row!.redemption_count === 1 ? " has" : "s have"} already redeemed this code, so the
          code text and the money off are fixed. Archive it if the terms need to change.
        </div>
      )}

      <form
        onSubmit={onSubmit}
        className="space-y-5 rounded-xl border border-border bg-card p-6 shadow-soft"
      >
        {!frozen && (
          <div className="space-y-1.5">
            <Label htmlFor="pc-code">Code</Label>
            <Input
              id="pc-code"
              value={customCode}
              onChange={(e) => setCustomCode(e.target.value.toUpperCase())}
              placeholder={isNew ? "Leave blank to generate one" : undefined}
              maxLength={24}
              pattern="[A-Za-z0-9-]{3,24}"
              required={!isNew}
            />
            <p className="text-xs text-muted">
              3–24 characters, letters, numbers and hyphens.
              {isNew
                ? " Leave it blank and we generate an 8-character one that has no characters members mix up when reading it aloud."
                : " Editable until the first member redeems it."}
            </p>
          </div>
        )}

        <div className="space-y-1.5">
          <Label htmlFor="pc-label">Label</Label>
          <Input
            id="pc-label"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            maxLength={160}
            placeholder="S$20 off"
            required
          />
          <p className="text-xs text-muted">Members see this next to the code at checkout.</p>
        </div>

        <fieldset className="space-y-2" disabled={frozen}>
          <Label>How much comes off</Label>
          <div className="flex flex-wrap items-center gap-4">
            <label className="flex items-center gap-2 text-sm text-ink">
              <input
                type="radio"
                name="pc-kind"
                checked={kind === "amount"}
                onChange={() => setKind("amount")}
              />
              Fixed amount
            </label>
            <label className="flex items-center gap-2 text-sm text-ink">
              <input
                type="radio"
                name="pc-kind"
                checked={kind === "percent"}
                onChange={() => setKind("percent")}
              />
              Percentage
            </label>
          </div>
          {kind === "amount" ? (
            <Input
              aria-label="Amount off in SGD"
              type="number"
              step="0.01"
              min="0.01"
              value={amountOffSgd}
              onChange={(e) => setAmountOffSgd(e.target.value)}
              placeholder="20.00"
            />
          ) : (
            <Input
              aria-label="Percent off"
              type="number"
              step="1"
              min="1"
              max="99"
              value={percentOff}
              onChange={(e) => setPercentOff(e.target.value)}
              placeholder="25"
            />
          )}
          <p className="text-xs text-muted">
            {frozen
              ? "Fixed — a member has already accepted these terms."
              : "Fixed to this once the first member redeems the code."}
          </p>
        </fieldset>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="pc-cap">Total cap</Label>
            <Input
              id="pc-cap"
              type="number"
              min="1"
              step="1"
              value={maxRedemptions}
              onChange={(e) => setMaxRedemptions(e.target.value)}
              placeholder="Uncapped"
            />
            <p className="text-xs text-muted">Blank means uncapped.</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pc-expires">Expires</Label>
            <Input
              id="pc-expires"
              type="date"
              value={expiresOn}
              onChange={(e) => setExpiresOn(e.target.value)}
            />
            <p className="text-xs text-muted">Blank means never. Runs to the end of the day.</p>
          </div>
        </div>

        <div className="space-y-2">
          <Label>What it applies to</Label>
          <div className="flex flex-wrap items-center gap-4">
            <label className="flex items-center gap-2 text-sm text-ink">
              <input
                type="radio"
                name="pc-scope"
                checked={appliesToAll}
                onChange={() => setAppliesToAll(true)}
              />
              Everything
            </label>
            <label className="flex items-center gap-2 text-sm text-ink">
              <input
                type="radio"
                name="pc-scope"
                checked={!appliesToAll}
                onChange={() => setAppliesToAll(false)}
              />
              Selected products
            </label>
          </div>
          {!appliesToAll && (
            <div className="space-y-4 rounded-lg border border-border p-4">
              {PRODUCT_GROUPS.map((group) => {
                const items = catalogue.filter((p) => p.product_type === group.type);
                if (items.length === 0) return null;
                return (
                  <div key={group.type} className="space-y-1.5">
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">
                      {group.heading}
                    </h3>
                    {items.map((p) => (
                      <label
                        key={refKey(p)}
                        className="flex items-center gap-2 text-sm text-ink"
                      >
                        <input
                          type="checkbox"
                          checked={selected.has(refKey(p))}
                          onChange={() => toggleProduct(p)}
                        />
                        {p.name}
                      </label>
                    ))}
                  </div>
                );
              })}
              {!scopeValid && (
                <p className="text-xs text-error">Pick at least one product.</p>
              )}
              <p className="text-xs text-muted">
                Workshops are picked whole — every tier of a chosen workshop is covered.
                Corporate packages are direct-pay and cannot carry a code.
              </p>
            </div>
          )}
        </div>

        {saveError && (
          <div className="rounded-lg border border-error/30 bg-error/5 px-3 py-2 text-sm text-error">
            {saveError}
          </div>
        )}

        <div className="flex items-center justify-between gap-2 border-t border-border pt-4">
          <div className="text-xs text-muted">
            {savedAt && !saving && (
              <span className="inline-flex items-center gap-1 text-sage">
                <Check className="h-3.5 w-3.5" /> Saved
              </span>
            )}
          </div>
          <Button type="submit" disabled={saving || !canSubmit}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            {isNew ? "Create" : "Save"}
          </Button>
        </div>
      </form>
    </div>
  );
}
