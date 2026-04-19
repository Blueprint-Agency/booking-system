"use client";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useCurrentRole } from "@/lib/admin-auth";
import type { AdminRole } from "@/types";

const roleHome: Record<AdminRole, string> = {
  super: "/superadmin",
  admin: "/admin/dashboard",
  instructor: "/instructor",
};

export function RoleGate({ role, children }: { role: AdminRole; children: React.ReactNode }) {
  const current = useCurrentRole();
  const router = useRouter();
  useEffect(() => {
    if (current !== null && current !== role) {
      router.replace(roleHome[current]);
    }
  }, [current, role, router]);
  if (current !== role) return null;
  return <>{children}</>;
}
