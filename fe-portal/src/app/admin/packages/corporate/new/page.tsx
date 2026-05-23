"use client";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { Button, PageHeader, Input, Label, Textarea } from "@/components/ui";
import { useWorkspace } from "@/lib/workspace-context";
import { ApiError } from "@/lib/api";

export default function NewCorporatePackagePage() {
  const router = useRouter();
  const { api } = useWorkspace();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [priceSgd, setPriceSgd] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!api) return;
    setError(null);
    setSubmitting(true);
    try {
      await api.post("/portal/admin/corporate-packages", {
        name: name.trim(),
        description: description.trim() ? description.trim() : null,
        price_sgd: priceSgd,
      });
      router.push("/admin/packages/corporate");
    } catch (err) {
      if (err instanceof ApiError) {
        const body = err.body as { error?: string; message?: string } | null;
        setError(body?.message ?? body?.error ?? `Failed (HTTP ${err.status})`);
      } else {
        setError("Network error");
      }
      setSubmitting(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <PageHeader
        title="New corporate package"
        description="Configure a B2B offering. Not visible to members."
        actions={
          <Link href="/admin/packages/corporate">
            <Button variant="ghost">Cancel</Button>
          </Link>
        }
      />

      <form
        onSubmit={onSubmit}
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
            placeholder="e.g. Acme Corp — Monthly"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="cp-description">Description</Label>
          <Textarea
            id="cp-description"
            rows={4}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Optional internal notes about this offering."
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
            placeholder="0.00"
          />
        </div>

        {error && (
          <div className="rounded-lg border border-error/30 bg-error/5 px-3 py-2 text-sm text-error">
            {error}
          </div>
        )}

        <div className="flex items-center justify-end gap-2 border-t border-border pt-4">
          <Link href="/admin/packages/corporate">
            <Button type="button" variant="ghost">
              Cancel
            </Button>
          </Link>
          <Button type="submit" disabled={submitting || !name.trim() || !priceSgd}>
            {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
            Create
          </Button>
        </div>
      </form>
    </div>
  );
}
