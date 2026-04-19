"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useCurrentAdmin } from "@/lib/mock-auth";

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const admin = useCurrentAdmin();
  const router = useRouter();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (mounted && !admin) {
      router.replace("/login");
    }
  }, [admin, mounted, router]);

  if (!mounted) return null;
  if (!admin) return null;

  return <>{children}</>;
}
