"use client";
import { useState } from "react";
import { Dialog, DialogFooter, Button, Input, Label } from "@/components/ui";
import { PromotionsEditor } from "./promotions-editor";
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
  const [priceSgd, setPriceSgd] = useState<string>(pkg?.priceSgd.toString() ?? "");
  const [promotions, setPromotions] = useState<Promotion[]>(pkg?.promotions ?? []);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    onSave({
      id: pkg?.id ?? `pt-${Date.now().toString(36)}`,
      name: name.trim(),
      sessionType,
      numSessions: Number(numSessions),
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

        <div className="grid gap-3 sm:grid-cols-2">
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

        <PromotionsEditor
          basePriceSgd={Number(priceSgd) || 0}
          value={promotions}
          onChange={setPromotions}
        />

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
