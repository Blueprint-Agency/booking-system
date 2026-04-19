"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { UserPlus, Search } from "lucide-react";
import { useAdminState } from "@/lib/admin-state";
import { useCurrentTenantId } from "@/lib/admin-auth";
import { useWithTenant } from "@/lib/tenant-scope";
import { Button, Input, Label, Select } from "@/components/ui";
import { addToRoster, createWalkInClient } from "@/lib/mutations/roster";
import type { Session } from "@/types";

export interface WalkInFormProps {
  session: Session;
}

type Mode = "existing" | "new";

export function WalkInForm({ session }: WalkInFormProps) {
  const tenantId = useCurrentTenantId();
  const allClients = useWithTenant(useAdminState((s) => s.clients));
  const allPackages = useAdminState((s) => s.clientPackages);
  const products = useAdminState((s) => s.products);
  const [mode, setMode] = useState<Mode>("existing");
  const [query, setQuery] = useState("");
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);
  const [packageId, setPackageId] = useState<string>("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const matches = useMemo(() => {
    if (!query.trim()) return [];
    const q = query.trim().toLowerCase();
    return allClients
      .filter(
        (c) =>
          c.name.toLowerCase().includes(q) ||
          c.phone.toLowerCase().includes(q) ||
          c.email.toLowerCase().includes(q),
      )
      .slice(0, 5);
  }, [allClients, query]);

  const eligiblePackages = useMemo(() => {
    if (!selectedClientId) return [];
    return allPackages.filter(
      (p) =>
        p.clientId === selectedClientId &&
        p.status === "active" &&
        p.sessionsRemaining > 0,
    );
  }, [allPackages, selectedClientId]);

  const productById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);

  const reset = () => {
    setQuery("");
    setSelectedClientId(null);
    setPackageId("");
    setName("");
    setPhone("");
  };

  const submit = () => {
    if (!tenantId) {
      toast.error("No tenant selected");
      return;
    }
    setSubmitting(true);
    try {
      let clientId = selectedClientId;
      if (mode === "new") {
        if (!name.trim() || !phone.trim()) {
          toast.error("Name and phone required");
          return;
        }
        const c = createWalkInClient({
          tenantId,
          name,
          phone,
          primaryLocationId: session.locationId,
        });
        clientId = c.id;
      }
      if (!clientId) {
        toast.error("Pick a client or create a new one");
        return;
      }
      addToRoster({
        sessionId: session.id,
        clientId,
        packageId: packageId || null,
        source: "walk-in",
      });
      toast.success(packageId ? "Walk-in added (credit deducted)" : "Walk-in added (paid on arrival)");
      reset();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-ink">Add walk-in</h3>
          <p className="text-xs text-muted">
            Find an existing client or create one inline.
          </p>
        </div>
        <div className="inline-flex rounded-md border border-border p-0.5 text-xs">
          <button
            type="button"
            onClick={() => {
              setMode("existing");
              reset();
            }}
            className={
              "rounded px-2 py-1 " +
              (mode === "existing" ? "bg-accent text-white" : "text-muted hover:text-ink")
            }
          >
            <Search className="-mt-0.5 mr-1 inline h-3 w-3" /> Existing
          </button>
          <button
            type="button"
            onClick={() => {
              setMode("new");
              reset();
            }}
            className={
              "rounded px-2 py-1 " +
              (mode === "new" ? "bg-accent text-white" : "text-muted hover:text-ink")
            }
          >
            <UserPlus className="-mt-0.5 mr-1 inline h-3 w-3" /> New
          </button>
        </div>
      </div>

      {mode === "existing" ? (
        <div className="space-y-3">
          <div>
            <Label>Client search</Label>
            <Input
              placeholder="Name, phone, or email"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setSelectedClientId(null);
                setPackageId("");
              }}
            />
            {matches.length > 0 && !selectedClientId && (
              <div className="mt-1 overflow-hidden rounded-md border border-border bg-card">
                {matches.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => {
                      setSelectedClientId(c.id);
                      setQuery(c.name);
                    }}
                    className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-paper"
                  >
                    <span className="text-ink">{c.name}</span>
                    <span className="text-xs text-muted">{c.phone}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          {selectedClientId && (
            <div>
              <Label>Use credit (optional)</Label>
              <Select value={packageId} onChange={(e) => setPackageId(e.target.value)}>
                <option value="">Paid on arrival (no credit)</option>
                {eligiblePackages.map((p) => (
                  <option key={p.id} value={p.id}>
                    {productById.get(p.productId)?.name ?? p.productId} — {p.sessionsRemaining} left
                  </option>
                ))}
              </Select>
            </div>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div>
            <Label htmlFor="walkin-name">Name</Label>
            <Input
              id="walkin-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Alice Tan"
            />
          </div>
          <div>
            <Label htmlFor="walkin-phone">Phone</Label>
            <Input
              id="walkin-phone"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+65 9123 4567"
            />
          </div>
        </div>
      )}

      <div className="mt-4 flex justify-end">
        <Button type="button" onClick={submit} disabled={submitting}>
          Add to roster
        </Button>
      </div>
    </div>
  );
}
