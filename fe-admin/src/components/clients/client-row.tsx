import Link from "next/link";
import type { Client, ClientPackage } from "@/types";
import { Badge } from "@/components/ui/badge";

export function ClientRow({
  client,
  packages,
}: {
  client: Client;
  packages: ClientPackage[];
}) {
  const activePackages = packages.filter(
    (p) => p.clientId === client.id && p.status === "active",
  );
  const totalCredits = activePackages.reduce((acc, p) => acc + p.creditsRemaining, 0);
  return (
    <tr className="border-t border-ink/5 hover:bg-paper/40">
      <td className="px-4 py-3">
        <Link
          href={`/clients/${client.id}`}
          className="font-medium text-ink hover:text-accent"
        >
          {client.firstName} {client.lastName}
        </Link>
        <div className="text-xs text-ink/50">{client.email}</div>
      </td>
      <td className="px-4 py-3 text-sm text-ink/70">{client.phone}</td>
      <td className="px-4 py-3">
        <Badge tone={client.activityStatus === "active" ? "sage" : "neutral"}>
          {client.activityStatus}
        </Badge>
      </td>
      <td className="px-4 py-3 text-sm font-mono text-ink/70">{totalCredits}</td>
      <td className="px-4 py-3">
        {client.waiverSigned ? (
          <Badge tone="sage">signed v{client.waiverVersion ?? "–"}</Badge>
        ) : (
          <Badge tone="warning">unsigned</Badge>
        )}
      </td>
      <td className="px-4 py-3 text-sm text-ink/60">{client.noShowCount}</td>
    </tr>
  );
}
