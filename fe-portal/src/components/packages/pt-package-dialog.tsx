"use client";
import { useState } from "react";
import { Dialog, DialogFooter, Button, Input, Label } from "@/components/ui";
import { PromotionsEditor } from "./promotions-editor";
import { hasPromotionOverlap } from "@/lib/promotions";
import type { PtPackage, PtSessionType, Promotion } from "@/types";

export function PtPackageDialog({
  pkg,
  onSave,
  onClose,
}: {
  pkg: PtPackage | null;
  onSave: (pkg: PtPackage) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(pkg?.name ?? "");
  const [sessionType, setSessionType] = useState<PtSessionType>(pkg?.sessionType ?? "1on1");
  const [numSessions, setNumSessions] = useState<string>(pkg?.numSessions.toString() ?? "");
  const [validityDays, setValidityDays] = useState<string>(pkg?.validityDays.toString() ?? "");
  const [instructorBound, setInstructorBound] = useState<boolean>(pkg?.instructorBound ?? false);
  const [priceSgd, setPriceSgd] = useState<string>(pkg?.priceSgd.toString() ?? "");
  const [promotions, setPromotions] = useState<Promotion[]>(pkg?.promotions ?? []);
  const promosOverlap = hasPromotionOverlap(promotions);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (promosOverlap) return;
    onSave({
      id: pkg?.id ?? `pt-${Date.now().toString(36)}`,
      name: name.trim(),
      sessionType,
      numSessions: Number(numSessions),
      validityDays: Number(validityDays),
      instructorBound,
      priceSgd: Number(priceSgd),
      status: pkg?.status ?? "active",
      promotions,
    });
  }

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={pkg ? "Edit PT package" : "Add PT package"}
    >
      <form className="space-y-4" onSubmit={handleSubmit}>
        <div className="space-y-1.5">
          <Label>Session type</Label>
          <div className="flex gap-2">
            {(["1on1", "2on1"] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setSessionType(t)}
                className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition ${
                  sessionType === t
                    ? "border-accent bg-accent/10 text-accent"
                    : "border-border bg-paper text-muted hover:bg-warm hover:text-ink"
                }`}
              >
                {t === "1on1" ? "1-on-1" : "2-on-1"}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="pt-name">Name</Label>
          <Input
            id="pt-name"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. 5-Session 1-on-1 Pack"
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="pt-sessions">Number of sessions</Label>
            <Input
              id="pt-sessions"
              required
              type="number"
              min={1}
              value={numSessions}
              onChange={(e) => setNumSessions(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pt-validity">Validity (days)</Label>
            <Input
              id="pt-validity"
              required
              type="number"
              min={1}
              max={3650}
              value={validityDays}
              onChange={(e) => setValidityDays(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pt-price">Price (SGD)</Label>
            <Input
              id="pt-price"
              required
              type="number"
              min={0}
              step={1}
              value={priceSgd}
              onChange={(e) => setPriceSgd(e.target.value)}
            />
          </div>
        </div>

        {/* Instructor-Bound. Off by default, and editing it here moves future
            sales only — a package a member already bought keeps the instructor
            it was sold with. */}
        <label className="flex items-start gap-3 rounded-lg border border-border bg-paper px-3 py-2.5 cursor-pointer transition hover:bg-warm">
          <input
            type="checkbox"
            checked={instructorBound}
            onChange={(e) => setInstructorBound(e.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-border text-accent focus:ring-accent"
          />
          <span className="min-w-0">
            <span className="block text-sm font-medium text-ink">Instructor-bound</span>
            <span className="mt-0.5 block text-xs text-muted">
              The member picks one instructor at checkout, and every session in the package
              is with them. Changing this affects future sales only.
            </span>
          </span>
        </label>

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
