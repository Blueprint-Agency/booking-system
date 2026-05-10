"use client";
import { useState } from "react";
import { Dialog, DialogFooter, Button, Input, Label } from "@/components/ui";
import type { ClassPackage, ClassPackageKind } from "@/types";

export function ClassPackageDialog({
  pkg,
  onSave,
  onClose,
}: {
  pkg: ClassPackage | null;
  onSave: (pkg: ClassPackage) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(pkg?.name ?? "");
  const [kind, setKind] = useState<ClassPackageKind>(pkg?.kind ?? "credit_bundle");
  const [credits, setCredits] = useState<string>(pkg?.credits?.toString() ?? "");
  const [validityDays, setValidityDays] = useState<string>(pkg?.validityDays?.toString() ?? "");
  const [durationDays, setDurationDays] = useState<string>(pkg?.durationDays?.toString() ?? "");
  const [priceSgd, setPriceSgd] = useState<string>(pkg?.priceSgd.toString() ?? "");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    onSave({
      id: pkg?.id ?? `cp-${Date.now().toString(36)}`,
      name: name.trim(),
      kind,
      credits: kind === "credit_bundle" ? Number(credits) : null,
      validityDays: kind === "credit_bundle" ? Number(validityDays) : null,
      durationDays: kind === "unlimited" ? Number(durationDays) : null,
      priceSgd: Number(priceSgd),
      status: pkg?.status ?? "active",
    });
  }

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={pkg ? "Edit package" : "Add package"}
    >
      <form className="space-y-4" onSubmit={handleSubmit}>
        <div className="space-y-1.5">
          <Label>Type</Label>
          <div className="flex gap-2">
            {(["credit_bundle", "unlimited"] as const).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setKind(k)}
                className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition ${
                  kind === k
                    ? "border-accent bg-accent/10 text-accent"
                    : "border-border bg-paper text-muted hover:bg-warm hover:text-ink"
                }`}
              >
                {k === "credit_bundle" ? "Credit bundle" : "Unlimited"}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="pkg-name">Name</Label>
          <Input
            id="pkg-name"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={kind === "credit_bundle" ? "e.g. 5-Class Pack" : "e.g. Monthly Unlimited"}
          />
        </div>

        {kind === "credit_bundle" ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="pkg-credits">Credits</Label>
              <Input
                id="pkg-credits"
                required
                type="number"
                min={1}
                value={credits}
                onChange={(e) => setCredits(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pkg-validity">Validity (days)</Label>
              <Input
                id="pkg-validity"
                required
                type="number"
                min={1}
                value={validityDays}
                onChange={(e) => setValidityDays(e.target.value)}
              />
            </div>
          </div>
        ) : (
          <div className="space-y-1.5">
            <Label htmlFor="pkg-duration">Duration (days)</Label>
            <Input
              id="pkg-duration"
              required
              type="number"
              min={1}
              value={durationDays}
              onChange={(e) => setDurationDays(e.target.value)}
            />
          </div>
        )}

        <div className="space-y-1.5">
          <Label htmlFor="pkg-price">Price (SGD)</Label>
          <Input
            id="pkg-price"
            required
            type="number"
            min={0}
            step={1}
            value={priceSgd}
            onChange={(e) => setPriceSgd(e.target.value)}
          />
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit">{pkg ? "Save" : "Create"}</Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
