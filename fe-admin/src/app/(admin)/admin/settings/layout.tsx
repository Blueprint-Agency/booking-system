"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/admin/settings/policy", label: "Policy" },
  { href: "/admin/settings/waiver", label: "Waiver" },
  { href: "/admin/settings/locations", label: "Locations" },
  { href: "/admin/settings/profile", label: "My profile" },
];

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <>
      <PageHeader title="Settings" description="Studio policy, locations, and your account." />
      <div className="mt-6 grid grid-cols-1 lg:grid-cols-[200px_1fr] gap-6">
        <nav className="space-y-1">
          {NAV.map((item) => {
            const active = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "block rounded-md px-3 py-2 text-sm transition-colors",
                  active ? "bg-accent/10 text-accent" : "text-muted hover:bg-paper hover:text-ink",
                )}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="min-w-0">{children}</div>
      </div>
    </>
  );
}
