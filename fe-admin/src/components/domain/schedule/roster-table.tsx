"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Check, Clock, X, RotateCcw, MoreHorizontal, Trash2 } from "lucide-react";
import { useAdminState } from "@/lib/admin-state";
import { Avatar, Badge, Button, EmptyState, StatusBadge } from "@/components/ui";
import { DataTable, type DataTableColumn } from "@/components/data-table";
import { markAttendance } from "@/lib/mutations/roster";
import { CancelWithPolicyDialog } from "@/components/domain/bookings/cancel-with-policy-dialog";
import { toast } from "sonner";
import type { Booking, Session } from "@/types";

export interface RosterTableProps {
  session: Session;
}

interface RosterRow {
  booking: Booking;
  clientName: string;
  packageLabel: string;
}

export function RosterTable({ session }: RosterTableProps) {
  const allBookings = useAdminState((s) => s.bookings);
  const clients = useAdminState((s) => s.clients);
  const packages = useAdminState((s) => s.clientPackages);
  const products = useAdminState((s) => s.products);
  const [cancelTarget, setCancelTarget] = useState<Booking | null>(null);

  const clientById = useMemo(() => new Map(clients.map((c) => [c.id, c])), [clients]);
  const productById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const packageById = useMemo(() => new Map(packages.map((p) => [p.id, p])), [packages]);

  const rows: RosterRow[] = useMemo(
    () =>
      allBookings
        .filter((b) => b.sessionId === session.id && b.status !== "cancelled")
        .map((b) => {
          const c = clientById.get(b.clientId);
          let packageLabel = "—";
          if (b.packageId) {
            const pkg = packageById.get(b.packageId);
            if (pkg) {
              const prod = productById.get(pkg.productId);
              packageLabel = prod?.name ?? pkg.productId;
            }
          } else if (b.source === "walk-in") {
            packageLabel = "Paid on arrival";
          } else if (b.source === "admin") {
            packageLabel = "Admin add";
          }
          return { booking: b, clientName: c?.name ?? "Unknown", packageLabel };
        })
        .sort((a, b) =>
          a.clientName.localeCompare(b.clientName, undefined, { sensitivity: "base" }),
        ),
    [allBookings, session.id, clientById, packageById, productById],
  );

  const update = (b: Booking, status: Booking["checkInStatus"]) => {
    try {
      markAttendance({ bookingId: b.id, status });
      toast.success(`Marked ${status}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    }
  };

  const columns: DataTableColumn<RosterRow>[] = [
    {
      key: "client",
      header: "Client",
      sortable: true,
      sortValue: (r) => r.clientName,
      cell: (r) => {
        const c = clientById.get(r.booking.clientId);
        return c ? (
          <Link
            href={`/admin/clients/${c.id}`}
            className="flex items-center gap-2 hover:text-accent"
          >
            <Avatar name={r.clientName} size={28} />
            <div>
              <div className="text-sm font-medium text-ink">{r.clientName}</div>
              <div className="text-xs text-muted">{c.phone}</div>
            </div>
          </Link>
        ) : (
          <span className="text-sm text-muted">{r.clientName}</span>
        );
      },
    },
    {
      key: "package",
      header: "Package",
      cell: (r) => <span className="text-sm text-muted">{r.packageLabel}</span>,
    },
    {
      key: "source",
      header: "Source",
      cell: (r) => (
        <Badge tone="neutral">{r.booking.source ?? "client"}</Badge>
      ),
    },
    {
      key: "status",
      header: "Status",
      cell: (r) => <StatusBadge status={r.booking.checkInStatus} />,
    },
    {
      key: "actions",
      header: "",
      align: "right",
      cell: (r) => {
        const b = r.booking;
        return (
          <div className="flex items-center justify-end gap-1">
            <button
              type="button"
              title="Mark attended"
              onClick={() => update(b, "attended")}
              className="rounded p-1.5 text-muted hover:bg-paper hover:text-sage"
            >
              <Check className="h-4 w-4" />
            </button>
            <button
              type="button"
              title="Mark late"
              onClick={() => update(b, "late")}
              className="rounded p-1.5 text-muted hover:bg-paper hover:text-warning"
            >
              <Clock className="h-4 w-4" />
            </button>
            <button
              type="button"
              title="Mark no-show"
              onClick={() => update(b, "no-show")}
              className="rounded p-1.5 text-muted hover:bg-paper hover:text-error"
            >
              <X className="h-4 w-4" />
            </button>
            <button
              type="button"
              title="Reset to pending"
              onClick={() => update(b, "pending")}
              className="rounded p-1.5 text-muted hover:bg-paper hover:text-ink"
            >
              <RotateCcw className="h-4 w-4" />
            </button>
            <button
              type="button"
              title="Remove (with refund)"
              onClick={() => setCancelTarget(b)}
              className="rounded p-1.5 text-muted hover:bg-paper hover:text-error"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        );
      },
    },
  ];

  return (
    <>
      <DataTable<RosterRow>
        rows={rows}
        columns={columns}
        rowKey={(r) => r.booking.id}
        empty={
          <EmptyState
            title="No bookings yet"
            description="Add walk-ins below or wait for client bookings."
          />
        }
      />
      {cancelTarget && (
        <CancelWithPolicyDialog
          booking={cancelTarget}
          session={session}
          open={true}
          onOpenChange={(o) => !o && setCancelTarget(null)}
        />
      )}
    </>
  );
}
