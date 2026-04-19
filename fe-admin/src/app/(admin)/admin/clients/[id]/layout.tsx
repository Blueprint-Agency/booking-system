"use client";

import { useParams, usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { useAdminState } from "@/lib/admin-state";
import { PageHeader, Avatar, Badge, EmptyState, Button } from "@/components/ui";
import { cn } from "@/lib/utils";

const TABS = [
  { slug: "", label: "Profile" },
  { slug: "packages", label: "Packages" },
  { slug: "bookings", label: "Bookings" },
  { slug: "timeline", label: "Timeline" },
  { slug: "invoices", label: "Invoices" },
  { slug: "referral", label: "Referral" },
  { slug: "account", label: "Account" },
];

export default function ClientLayout({ children }: { children: React.ReactNode }) {
  const { id } = useParams<{ id: string }>();
  const pathname = usePathname();
  const router = useRouter();
  const client = useAdminState((s) => s.clients.find((c) => c.id === id));

  if (!client) {
    return (
      <EmptyState
        title="Client not found"
        description="This client doesn't exist or isn't in your tenant."
        cta={{ href: "/admin/clients", label: "Back to clients" }}
      />
    );
  }

  const basePath = `/admin/clients/${id}`;
  const currentSlug = pathname === basePath ? "" : pathname.split("/").pop() ?? "";

  return (
    <>
      <div className="flex items-center gap-2 text-sm text-muted mb-4">
        <button
          type="button"
          onClick={() => router.push("/admin/clients")}
          className="inline-flex items-center gap-1 hover:text-ink"
        >
          <ArrowLeft className="h-4 w-4" /> Clients
        </button>
      </div>
      <PageHeader
        title={client.name}
        description={`${client.email} · ${client.phone}`}
        actions={
          <>
            <Badge tone={client.activityStatus === "active" ? "sage" : "neutral"}>
              {client.activityStatus}
            </Badge>
            <Link href={`/admin/clients/${client.id}/grant`}>
              <Button variant="secondary">Grant credits</Button>
            </Link>
          </>
        }
      />
      <div className="flex items-center gap-4 mt-4 mb-6">
        <Avatar name={client.name} size={56} className="text-base" />
        <div className="flex flex-wrap gap-1.5">
          <Badge tone={client.waiverSignedAt ? "sage" : "warning"}>
            {client.waiverSignedAt ? "Waiver signed" : "Waiver not signed"}
          </Badge>
          {client.noShowCount > 0 && (
            <Badge tone={client.noShowCount >= 3 ? "error" : "warning"}>
              {client.noShowCount} no-shows
            </Badge>
          )}
        </div>
      </div>
      <nav className="flex items-center gap-1 border-b border-border mb-6">
        {TABS.map((t) => {
          const href = t.slug ? `${basePath}/${t.slug}` : basePath;
          const active = currentSlug === t.slug;
          return (
            <Link
              key={t.slug}
              href={href}
              className={cn(
                "px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors",
                active
                  ? "border-accent text-ink"
                  : "border-transparent text-muted hover:text-ink",
              )}
            >
              {t.label}
            </Link>
          );
        })}
      </nav>
      {children}
    </>
  );
}
