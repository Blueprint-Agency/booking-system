"use client";

import { useMemo } from "react";
import type { AdminUser, AuditAction } from "@/types";
import { Select, Input } from "@/components/ui";

export interface AuditFilterValue {
  actorId: string;
  action: string;
  from: string;
  to: string;
  text: string;
}

export const EMPTY_AUDIT_FILTER: AuditFilterValue = {
  actorId: "",
  action: "",
  from: "",
  to: "",
  text: "",
};

const ACTIONS: AuditAction[] = [
  "client.create",
  "client.update",
  "client.merge",
  "client.softDelete",
  "credit.grant",
  "credit.adjust",
  "package.extend",
  "package.refund",
  "membership.pause",
  "membership.cancel",
  "invoice.refund",
  "session.create",
  "session.update",
  "session.cancel",
  "booking.cancelAdmin",
  "private.accept",
  "private.decline",
  "private.proposeAlt",
  "product.create",
  "product.update",
  "product.archive",
  "promo.create",
  "promo.disable",
  "referral.approve",
  "referral.deny",
  "policy.edit",
  "cms.publish",
  "broadcast.send",
  "tenant.create",
  "tenant.update",
  "tenant.suspend",
  "featureFlag.set",
];

export interface AuditFiltersProps {
  value: AuditFilterValue;
  onChange: (next: AuditFilterValue) => void;
  actors: AdminUser[];
}

export function AuditFilters({ value, onChange, actors }: AuditFiltersProps) {
  const actorOptions = useMemo(
    () => [{ id: "", name: "All actors" }, ...actors.map((a) => ({ id: a.id, name: a.name }))],
    [actors],
  );
  const set = <K extends keyof AuditFilterValue>(key: K, v: AuditFilterValue[K]) =>
    onChange({ ...value, [key]: v });

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Select
        value={value.actorId}
        onChange={(e) => set("actorId", e.target.value)}
        aria-label="Filter by actor"
        className="w-44"
      >
        {actorOptions.map((a) => (
          <option key={a.id || "all"} value={a.id}>
            {a.name}
          </option>
        ))}
      </Select>
      <Select
        value={value.action}
        onChange={(e) => set("action", e.target.value)}
        aria-label="Filter by action"
        className="w-52"
      >
        <option value="">All actions</option>
        {ACTIONS.map((a) => (
          <option key={a} value={a}>
            {a}
          </option>
        ))}
      </Select>
      <Input
        type="date"
        value={value.from}
        onChange={(e) => set("from", e.target.value)}
        className="w-40"
        aria-label="From date"
      />
      <Input
        type="date"
        value={value.to}
        onChange={(e) => set("to", e.target.value)}
        className="w-40"
        aria-label="To date"
      />
      <Input
        value={value.text}
        onChange={(e) => set("text", e.target.value)}
        placeholder="Search note / entity"
        className="flex-1 min-w-[200px] max-w-sm"
      />
    </div>
  );
}
