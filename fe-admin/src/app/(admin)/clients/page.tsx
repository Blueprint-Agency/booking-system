"use client";

import { useMemo, useState } from "react";
import { PageHeader } from "@/components/ui/page-header";
import { ClientRow } from "@/components/clients/client-row";
import { ClientFilters, type ClientFilterState } from "@/components/clients/client-filters";
import { useAdminState } from "@/lib/mock-state";

export default function ClientsPage() {
  const state = useAdminState();
  const [filters, setFilters] = useState<ClientFilterState>({
    q: "",
    waiver: "all",
    activity: "all",
  });

  const filtered = useMemo(() => {
    const q = filters.q.trim().toLowerCase();
    return state.clients.filter((c) => {
      if (filters.activity !== "all" && c.activityStatus !== filters.activity) return false;
      if (filters.waiver === "signed" && !c.waiverSigned) return false;
      if (filters.waiver === "unsigned" && c.waiverSigned) return false;
      if (!q) return true;
      const hay = `${c.firstName} ${c.lastName} ${c.email} ${c.phone}`.toLowerCase();
      return hay.includes(q);
    });
  }, [state.clients, filters]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Clients"
        description={`${state.clients.length} total · ${filtered.length} shown`}
      />
      <ClientFilters value={filters} onChange={setFilters} />
      <div className="overflow-hidden rounded-xl border border-ink/10 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-paper/60 text-left text-[11px] font-semibold uppercase tracking-wide text-ink/60">
            <tr>
              <th className="px-4 py-2">Client</th>
              <th className="px-4 py-2">Phone</th>
              <th className="px-4 py-2">Status</th>
              <th className="px-4 py-2">Credits</th>
              <th className="px-4 py-2">Waiver</th>
              <th className="px-4 py-2">No-shows</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((c) => (
              <ClientRow key={c.id} client={c} packages={state.clientPackages} />
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && (
          <div className="p-8 text-center text-sm text-ink/50">No clients match the filters.</div>
        )}
      </div>
    </div>
  );
}
