"use client";

import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { useCurrentAdmin, signOutAdmin } from "@/lib/mock-auth";
import { Button } from "@/components/ui/button";
import { initials } from "@/lib/utils";

export function AdminTopbar() {
  const admin = useCurrentAdmin();
  const router = useRouter();

  if (!admin) return null;

  return (
    <header className="sticky top-0 z-20 flex items-center justify-between bg-paper/80 backdrop-blur border-b border-border px-6 py-3">
      <div className="text-sm text-muted">
        Signed in as <span className="text-ink font-medium">{admin.firstName} {admin.lastName}</span>
      </div>
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          <span className="h-8 w-8 rounded-full bg-accent text-paper flex items-center justify-center text-xs font-bold">
            {initials(admin.firstName, admin.lastName)}
          </span>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            signOutAdmin();
            router.push("/login");
          }}
        >
          <LogOut className="h-4 w-4" />
          Sign out
        </Button>
      </div>
    </header>
  );
}
