"use client";
import { useState } from "react";
import { Dialog, DialogFooter, Button, Input, Label } from "@/components/ui";
import { PromotionsEditor } from "./promotions-editor";
import { hasPromotionOverlap } from "@/lib/promotions";
import type { ClassPackage, ClassPackageKind, Promotion } from "@/types";

const KIND_LABELS: Record<ClassPackageKind, string> = {
  credit_bundle: "Credit bundle",
  unlimited: "Unlimited",
  trial: "Trial pass",
};

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
  const [description, setDescription] = useState(pkg?.description ?? "");
  const [kind, setKind] = useState<ClassPackageKind>(pkg?.kind ?? "credit_bundle");
  const [credits, setCredits] = useState<string>(pkg?.credits?.toString() ?? "");
  const [validityDays, setValidityDays] = useState<string>(pkg?.validityDays?.toString() ?? "");
  const [durationDays, setDurationDays] = useState<string>(pkg?.durationDays?.toString() ?? "");
  const [priceSgd, setPriceSgd] = useState<string>(pkg?.priceSgd.toString() ?? "");
  const [promotions, setPromotions] = useState<Promotion[]>(pkg?.promotions ?? []);
  const promosOverlap = hasPromotionOverlap(promotions);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (promosOverlap) return;
    onSave({
      id: pkg?.id ?? `cp-${Date.now().toString(36)}`,
      name: name.trim(),
      description: description.trim(),
      kind,
      credits: kind === "credit_bundle" || kind === "trial" ? Number(credits) : null,
      validityDays:
        kind === "credit_bundle"
          ? Number(validityDays)
          : kind === "trial"
          ? validityDays
            ? Number(validityDays)
            : null
          : null,
      durationDays: kind === "unlimited" ? Number(durationDays) : null,
      priceSgd: Number(priceSgd),
      status: pkg?.status ?? "active",
      promotions,
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
            {(["credit_bundle", "unlimited", "trial"] as const).map((k) => (
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
                {KIND_LABELS[k]}
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
            placeholder={
              kind === "credit_bundle"
                ? "e.g. 5-Class Pack"
                : kind === "unlimited"
                ? "e.g. Monthly Unlimited"
                : "e.g. Trial Pass"
            }
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="pkg-desc">
            Description {kind === "trial" ? "" : "(optional)"}
          </Label>
          <textarea
            id="pkg-desc"
            required={kind === "trial"}
            rows={2}
            maxLength={280}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Short marketing blurb shown to customers."
            className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm"
          />
        </div>

        {kind === "credit_bundle" && (
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
        )}

        {kind === "unlimited" && (
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

        {kind === "trial" && (
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="pkg-trial-quota">Class quota</Label>
              <Input
                id="pkg-trial-quota"
                required
                type="number"
                min={1}
                value={credits}
                onChange={(e) => setCredits(e.target.value)}
                placeholder="Usually 1"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pkg-trial-validity">Validity (days, optional)</Label>
              <Input
                id="pkg-trial-validity"
                type="number"
                min={1}
                value={validityDays}
                onChange={(e) => setValidityDays(e.target.value)}
                placeholder="e.g. 30"
              />
            </div>
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

        <PromotionsEditor
          basePriceSgd={Number(priceSgd) || 0}
          value={promotions}
          onChange={setPromotions}
        />

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={promosOverlap}>
            {pkg ? "Save" : "Create"}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
