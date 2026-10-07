"use client";
import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Badge, Select } from "@/components/ui";
import { ApiError } from "@/lib/api";
import { movementLine, type CreditHistory } from "@/lib/credit-history";
import { formatDate, formatDateTime } from "@/lib/formatters";
import { useWorkspace } from "@/lib/workspace-context";

interface PackageOption {
  id: string;
  kind: string;
  package_name: string;
}

/**
 * A package's Credit history on the member's profile (#353): every movement of
 * its credits or sessions, newest first, with the booking it was for, who did
 * it and the balance after. One package at a time, picked from the member's.
 *
 * `refreshKey` changes whenever the profile is read again, so an adjustment
 * made on this page shows here at once.
 */
export function CreditHistoryPanel({
  clientId,
  packages,
  refreshKey,
}: {
  clientId: string;
  packages: PackageOption[];
  refreshKey: unknown;
}) {
  const { api } = useWorkspace();
  const [packageId, setPackageId] = useState(packages[0]?.id ?? "");
  const [history, setHistory] = useState<CreditHistory | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pkg = packages.find((p) => p.id === packageId);

  useEffect(() => {
    if (!api || !packageId) return;
    let live = true;
    api
      .get<CreditHistory>(`/portal/admin/clients/${clientId}/packages/${packageId}/credit-history`)
      .then((h) => {
        if (!live) return;
        setHistory(h);
        setError(null);
      })
      .catch((err) => live && setError(err instanceof ApiError ? `HTTP ${err.status}` : "Network error"));
    return () => {
      live = false;
    };
  }, [api, clientId, packageId, refreshKey]);

  if (!pkg) return null;
  const unit = pkg.kind === "pt" ? "session" : "credit";

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card shadow-soft">
      <div className="border-b border-border px-4 py-3 sm:px-5">
        <Select
          aria-label="Package"
          value={packageId}
          onChange={(e) => {
            setHistory(null);
            setPackageId(e.target.value);
          }}
        >
          {packages.map((p) => (
            <option key={p.id} value={p.id}>
              {p.package_name}
            </option>
          ))}
        </Select>
      </div>
      {error ? (
        <p className="px-4 py-3 text-sm text-error sm:px-5">Credit history could not be loaded ({error}).</p>
      ) : !history ? (
        <div className="flex justify-center px-4 py-6">
          <Loader2 className="h-4 w-4 animate-spin text-muted" aria-label="Loading" />
        </div>
      ) : (
        <>
          {history.movements.length === 0 ? (
            <p className="px-4 py-3 text-sm text-muted sm:px-5">Nothing has moved on this package yet.</p>
          ) : (
            <ul className="divide-y divide-border">
              {history.movements.map((m) => {
                const line = movementLine(m, unit);
                const booking = m.booking
                  ? [m.booking.title ?? (m.booking.kind === "pt" ? "Private session" : "Booking"), m.booking.starts_at && formatDateTime(m.booking.starts_at)]
                      .filter(Boolean)
                      .join(" · ")
                  : null;
                const who = m.actor === "staff" ? (m.staff_name ?? "Staff") : m.actor === "member" ? "Member" : "System";
                return (
                  <li key={m.id} className="flex items-start gap-3 px-4 py-3 sm:px-5">
                    <div className="w-14 shrink-0">
                      {line.amount ? (
                        <Badge tone={line.amount.startsWith("+") ? "sage" : "error"}>{line.amount}</Badge>
                      ) : (
                        <Badge tone="neutral">0</Badge>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="break-words text-sm text-ink">{line.label}</div>
                      {booking && <div className="break-words text-xs text-muted">{booking}</div>}
                      {m.note && <div className="break-words text-xs text-muted">{m.note}</div>}
                      <div className="text-xs text-muted">
                        {who} · {formatDateTime(m.at)}
                      </div>
                    </div>
                    {line.balance !== null && (
                      <span className="shrink-0 text-xs tabular-nums text-muted">Balance {line.balance}</span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          <p className="border-t border-border px-4 py-2 text-xs text-muted sm:px-5">
            History from {formatDate(history.history_from, "d MMM yyyy")}
          </p>
        </>
      )}
    </div>
  );
}
