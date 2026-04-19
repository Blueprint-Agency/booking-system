"use client";

import { useMemo } from "react";
import type { Client, ClientPackage, Location, Product } from "@/types";
import { Select, Input } from "@/components/ui";

export interface ClientFilterValue {
  packageStatus: "" | "active" | "expired" | "none";
  noShow: "" | "gte3" | "gte5";
  locationId: string;
  productId: string;
  text: string;
}

export const EMPTY_CLIENT_FILTER: ClientFilterValue = {
  packageStatus: "",
  noShow: "",
  locationId: "",
  productId: "",
  text: "",
};

export interface ClientFiltersProps {
  value: ClientFilterValue;
  onChange: (next: ClientFilterValue) => void;
  locations: Location[];
  products: Product[];
  packages: ClientPackage[];
}

export function ClientFilters({ value, onChange, locations, products, packages }: ClientFiltersProps) {
  const productOptions = useMemo(() => {
    const owned = new Set(packages.map((p) => p.productId));
    return products
      .filter((p) => owned.has(p.id))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [packages, products]);

  const set = <K extends keyof ClientFilterValue>(k: K, v: ClientFilterValue[K]) =>
    onChange({ ...value, [k]: v });

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Select
        value={value.packageStatus}
        onChange={(e) => set("packageStatus", e.target.value as ClientFilterValue["packageStatus"])}
        aria-label="Filter by package status"
        className="w-44"
      >
        <option value="">Any package</option>
        <option value="active">Active package</option>
        <option value="expired">Expired</option>
        <option value="none">No package</option>
      </Select>
      <Select
        value={value.productId}
        onChange={(e) => set("productId", e.target.value)}
        aria-label="Filter by package product"
        className="w-56"
      >
        <option value="">All products</option>
        {productOptions.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </Select>
      <Select
        value={value.noShow}
        onChange={(e) => set("noShow", e.target.value as ClientFilterValue["noShow"])}
        aria-label="Filter by no-show count"
        className="w-40"
      >
        <option value="">Any no-shows</option>
        <option value="gte3">≥3 no-shows</option>
        <option value="gte5">≥5 no-shows</option>
      </Select>
      <Select
        value={value.locationId}
        onChange={(e) => set("locationId", e.target.value)}
        aria-label="Filter by location"
        className="w-44"
      >
        <option value="">All locations</option>
        {locations.map((l) => (
          <option key={l.id} value={l.id}>
            {l.shortName || l.name}
          </option>
        ))}
      </Select>
      <Input
        value={value.text}
        onChange={(e) => set("text", e.target.value)}
        placeholder="Name, phone, or email"
        className="flex-1 min-w-[200px] max-w-sm"
      />
    </div>
  );
}

export function applyClientFilter(
  clients: Client[],
  packages: ClientPackage[],
  f: ClientFilterValue,
): Client[] {
  const pkgByClient = new Map<string, ClientPackage[]>();
  packages.forEach((p) => {
    const arr = pkgByClient.get(p.clientId) ?? [];
    arr.push(p);
    pkgByClient.set(p.clientId, arr);
  });
  const text = f.text.trim().toLowerCase();
  return clients.filter((c) => {
    const pkgs = pkgByClient.get(c.id) ?? [];
    if (f.packageStatus === "active" && !pkgs.some((p) => p.status === "active")) return false;
    if (f.packageStatus === "expired" && !pkgs.some((p) => p.status === "expired")) return false;
    if (f.packageStatus === "none" && pkgs.length > 0) return false;
    if (f.productId && !pkgs.some((p) => p.productId === f.productId)) return false;
    if (f.noShow === "gte3" && c.noShowCount < 3) return false;
    if (f.noShow === "gte5" && c.noShowCount < 5) return false;
    if (f.locationId && c.primaryLocationId !== f.locationId) return false;
    if (text) {
      const hay = `${c.name} ${c.email} ${c.phone}`.toLowerCase();
      if (!hay.includes(text)) return false;
    }
    return true;
  });
}
