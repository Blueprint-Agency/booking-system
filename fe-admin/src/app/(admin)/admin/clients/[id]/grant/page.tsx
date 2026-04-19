"use client";

import { useState, useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useAdminState } from "@/lib/admin-state";
import { Button, Input, Label, Select, Textarea, PageHeader, EmptyState } from "@/components/ui";
import { grantCredits } from "@/lib/mutations/packages";

export default function ManualGrantPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const client = useAdminState((s) => s.clients.find((c) => c.id === id));
  const products = useAdminState((s) => s.products);

  const granters = useMemo(
    () =>
      products.filter(
        (p) => p.active && (p.type === "package" || p.type === "drop-in"),
      ),
    [products],
  );

  const [productId, setProductId] = useState(granters[0]?.id ?? "");
  const [credits, setCredits] = useState<number>(1);
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  if (!client) {
    return (
      <EmptyState
        title="Client not found"
        cta={{ href: "/admin/clients", label: "Back to clients" }}
      />
    );
  }

  const trimmed = reason.trim();
  const canSubmit = !!productId && credits > 0 && trimmed.length > 0 && !submitting;

  const submit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      grantCredits({
        clientId: client.id,
        productId,
        sessions: credits,
        expiresAt: null,
        note: trimmed,
      });
      toast.success(`Granted ${credits} credit${credits === 1 ? "" : "s"} to ${client.name}`);
      router.push(`/admin/clients/${client.id}/audit`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to grant");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <div className="mb-3 text-xs text-muted">
        <Link href={`/admin/clients/${client.id}`} className="inline-flex items-center gap-1 hover:text-ink">
          <ArrowLeft className="h-3 w-3" /> Back to {client.name}
        </Link>
      </div>
      <PageHeader
        title="Manual credit grant"
        description={`Grant credits to ${client.name}. A reason is required and the action is audit-logged.`}
      />
      <div className="mt-6 max-w-lg space-y-4">
        <div>
          <Label>Package / credit type</Label>
          <Select value={productId} onChange={(e) => setProductId(e.target.value)}>
            <option value="">Select a package…</option>
            {granters.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} ({p.creditType})
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label>Credits to grant</Label>
          <Input
            type="number"
            min={1}
            value={credits}
            onChange={(e) => setCredits(Math.max(1, Number(e.target.value) || 1))}
          />
        </div>
        <div>
          <Label>Reason (required)</Label>
          <Textarea
            rows={4}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Why are you granting these credits? (e.g. apology for cancelled class)"
          />
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-border pt-4">
          <Button variant="ghost" type="button" onClick={() => router.push(`/admin/clients/${client.id}`)}>
            Cancel
          </Button>
          <Button type="button" disabled={!canSubmit} onClick={submit}>
            Grant credits
          </Button>
        </div>
      </div>
    </>
  );
}
