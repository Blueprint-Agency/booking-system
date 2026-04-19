"use client";

import { useState } from "react";
import type { Product } from "@/types";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { upsertProduct } from "@/lib/mock-state";

export function ProductForm({
  initial,
  open,
  onClose,
  defaultType = "package",
}: {
  initial?: Product;
  open: boolean;
  onClose: () => void;
  defaultType?: Product["type"];
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [type, setType] = useState<Product["type"]>(initial?.type ?? defaultType);
  const [creditType, setCreditType] = useState<Product["creditType"]>(
    initial?.creditType ?? "class",
  );
  const [price, setPrice] = useState(initial?.price ?? 0);
  const [sessionCount, setSessionCount] = useState<number | "">(
    initial?.sessionCount ?? "",
  );
  const [expiryDays, setExpiryDays] = useState<number | "">(initial?.expiryDays ?? "");
  const [sessionsPerMonth, setSessionsPerMonth] = useState<number | "">(
    initial?.sessionsPerMonth ?? "",
  );
  const [description, setDescription] = useState(initial?.description ?? "");
  const [active, setActive] = useState(initial?.active ?? true);

  const submit = () => {
    upsertProduct({
      id: initial?.id,
      name,
      type,
      creditType,
      price,
      sessionCount: sessionCount === "" ? null : Number(sessionCount),
      expiryDays: expiryDays === "" ? null : Number(expiryDays),
      sessionsPerMonth: sessionsPerMonth === "" ? null : Number(sessionsPerMonth),
      description,
      active,
    });
    onClose();
  };

  return (
    <Modal open={open} onClose={onClose} title={initial ? "Edit product" : "New product"}>
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <Label htmlFor="pf-name">Name</Label>
          <Input id="pf-name" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="pf-type">Type</Label>
          <Select id="pf-type" value={type} onChange={(e) => setType(e.target.value as Product["type"])}>
            <option value="package">Package</option>
            <option value="membership">Membership</option>
            <option value="workshop">Workshop</option>
            <option value="private-pack">Private pack</option>
          </Select>
        </div>
        <div>
          <Label htmlFor="pf-credit">Credit type</Label>
          <Select
            id="pf-credit"
            value={creditType}
            onChange={(e) => setCreditType(e.target.value as Product["creditType"])}
          >
            <option value="class">Class</option>
            <option value="pt">Private</option>
            <option value="none">None</option>
          </Select>
        </div>
        <div>
          <Label htmlFor="pf-price">Price (SGD)</Label>
          <Input id="pf-price" type="number" value={price} onChange={(e) => setPrice(Number(e.target.value))} />
        </div>
        <div>
          <Label htmlFor="pf-count">Session count</Label>
          <Input
            id="pf-count"
            type="number"
            value={sessionCount === "" ? "" : sessionCount}
            onChange={(e) => setSessionCount(e.target.value === "" ? "" : Number(e.target.value))}
          />
        </div>
        <div>
          <Label htmlFor="pf-exp">Expiry (days)</Label>
          <Input
            id="pf-exp"
            type="number"
            value={expiryDays === "" ? "" : expiryDays}
            onChange={(e) => setExpiryDays(e.target.value === "" ? "" : Number(e.target.value))}
          />
        </div>
        <div>
          <Label htmlFor="pf-spm">Sessions / month (unlimited only)</Label>
          <Input
            id="pf-spm"
            type="number"
            value={sessionsPerMonth === "" ? "" : sessionsPerMonth}
            onChange={(e) => setSessionsPerMonth(e.target.value === "" ? "" : Number(e.target.value))}
          />
        </div>
        <div className="col-span-2">
          <Label htmlFor="pf-desc">Description</Label>
          <Textarea
            id="pf-desc"
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
        <div className="col-span-2 flex items-center gap-2">
          <input
            id="pf-active"
            type="checkbox"
            checked={active}
            onChange={(e) => setActive(e.target.checked)}
          />
          <Label htmlFor="pf-active">Active (shown in client portal)</Label>
        </div>
      </div>
      <div className="mt-6 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button onClick={submit} disabled={!name.trim()}>Save</Button>
      </div>
    </Modal>
  );
}
