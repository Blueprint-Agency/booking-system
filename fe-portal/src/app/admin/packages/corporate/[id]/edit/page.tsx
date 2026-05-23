"use client";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Loader2, Check } from "lucide-react";
import { Button, PageHeader, Input, Label, Textarea, Badge } from "@/components/ui";
import { useWorkspace } from "@/lib/workspace-context";
import { ApiError } from "@/lib/api";

interface ApiCorporatePackage {
  id: string;
  name: string;
  description: string | null;
  price_sgd: string;
  status: "active" | "archived";
  archived_at: string | null;
  created_at: string;
}

export default function EditCorporatePackagePage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const id = params.id;
  const { api } = useWorkspace();

  const [row, setRow] = useState<ApiCorporatePackage | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [priceSgd, setPriceSgd] = useState("");

  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [archiveBusy, setArchiveBusy] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!api || !id) return;
    setLoading(true);
    setLoadError(null);
    try {
      const res = await api.get<{ corporatePackage: ApiCorporatePackage }>(
        `/portal/admin/corporate-packages/${id}`,
      );
      setRow(res.corporatePackage);
      setName(res.corporatePackage.name);
      setDescription(res.corporatePackage.description ?? "");
      setPriceSgd(res.corporatePackage.price_sgd);
    } catch (err) {
      setLoadError(err instanceof ApiError ? `HTTP ${err.status}` : "Network error");
    } finally {
      setLoading(false);
    }
  }, [api, id]);

  useEffect(() => {
    void load();
  }, [load]);

  const onSave = async (e: FormEvent) => {
    e.preventDefault();
    if (!api || !row) return;
    setSaveError(null);
    setSaving(true);
    try {
      const res = await api.patch<{ corporatePackage: ApiCorporatePackage }>(
        `/portal/admin/corporate-packages/${row.id}`,
        {
          name: name.trim(),
          description: description.trim() ? description.trim() : null,
          price_sgd: priceSgd,
        },
      );
      setRow(res.corporatePackage);
      setSavedAt(Date.now());
    } catch (err) {
      if (err instanceof ApiError) {
        const body = err.body as { error?: string; message?: string } | null;
        setSaveError(body?.message ?? body?.error ?? `Failed (HTTP ${err.status})`);
      } else {
        setSaveError("Network error");
      }
    } finally {
      setSaving(false);
    }
  };

  const onToggleArchive = async () => {
    if (!api || !row) return;
    setActionError(null);
    setArchiveBusy(true);
    try {
      const nextStatus = row.status === "archived" ? "active" : "archived";
      const res = await api.patch<{ corporatePackage: ApiCorporatePackage }>(
        `/portal/admin/corporate-packages/${row.id}`,
        { status: nextStatus },
      );
      setRow(res.corporatePackage);
    } catch (err) {
      if (err instanceof ApiError) {
        const body = err.body as { error?: string; message?: string } | null;
        setActionError(body?.message ?? body?.error ?? `Failed (HTTP ${err.status})`);
      } else {
        setActionError("Network error");
      }
    } finally {
      setArchiveBusy(false);
    }
  };

  const onDelete = async () => {
    if (!api || !row) return;
    if (!window.confirm("Delete this corporate package? This cannot be undone.")) return;
    setActionError(null);
    setDeleteBusy(true);
    try {
      await api.del(`/portal/admin/corporate-packages/${row.id}`);
      router.push("/admin/packages/corporate");
    } catch (err) {
      if (err instanceof ApiError) {
        const body = err.body as { error?: string } | null;
        if (err.status === 409 && body?.error === "in_use") {
          setActionError(
            "This package can't be deleted — it's referenced by one or more scheduled corporate sessions. Archive it instead.",
          );
        } else {
          setActionError(`Failed (HTTP ${err.status})`);
        }
      } else {
        setActionError("Network error");
      }
      setDeleteBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="mx-auto max-w-2xl">
        <div className="flex h-32 items-center justify-center gap-2 text-sm text-muted">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      </div>
    );
  }

  if (loadError || !row) {
    return (
      <div className="mx-auto max-w-2xl">
        <div className="rounded-xl border border-error/30 bg-error/5 p-6 text-center">
          <p className="text-sm text-error">Failed to load: {loadError ?? "Not found"}</p>
          <Button size="sm" variant="ghost" onClick={load} className="mt-2">
            Retry
          </Button>
        </div>
      </div>
    );
  }

  const isArchived = row.status === "archived";

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <PageHeader
        title="Edit corporate package"
        description="B2B offering. Not visible to members."
        actions={
          <div className="flex items-center gap-2">
            {isArchived ? (
              <Badge tone="neutral">Archived</Badge>
            ) : (
              <Badge tone="sage">Active</Badge>
            )}
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={onToggleArchive}
              disabled={archiveBusy}
            >
              {archiveBusy && <Loader2 className="h-4 w-4 animate-spin" />}
              {isArchived ? "Unarchive" : "Archive"}
            </Button>
            <Link href="/admin/packages/corporate">
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

      <form
        onSubmit={onSave}
        className="space-y-5 rounded-xl border border-border bg-card p-6 shadow-soft"
      >
        <div className="space-y-1.5">
          <Label htmlFor="cp-name">Name</Label>
          <Input
            id="cp-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={200}
            required
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="cp-description">Description</Label>
          <Textarea
            id="cp-description"
            rows={4}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="cp-price">Price (SGD)</Label>
          <Input
            id="cp-price"
            type="number"
            step="0.01"
            min="0"
            value={priceSgd}
            onChange={(e) => setPriceSgd(e.target.value)}
            required
          />
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
          <Button type="submit" disabled={saving || !name.trim() || !priceSgd}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            Save
          </Button>
        </div>
      </form>

      <div className="rounded-xl border border-error/30 bg-error/5 p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-sm font-semibold text-ink">Delete package</h2>
            <p className="mt-1 text-xs text-muted">
              Permanent. Only allowed if no corporate sessions reference this package.
            </p>
          </div>
          <Button
            type="button"
            variant="danger"
            size="sm"
            onClick={onDelete}
            disabled={deleteBusy}
          >
            {deleteBusy && <Loader2 className="h-4 w-4 animate-spin" />}
            Delete
          </Button>
        </div>
      </div>
    </div>
  );
}
