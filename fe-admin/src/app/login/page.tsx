"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Input, Label } from "@/components/ui";
import { useAdminState } from "@/lib/admin-state";
import { signInAs } from "@/lib/admin-auth";
import type { AdminRole } from "@/types";

const DEMO_PASSWORD = "demo1234";

const roleHome: Record<AdminRole, string> = {
  super: "/superadmin",
  admin: "/admin/dashboard",
  instructor: "/instructor",
};

const demoAccounts: { role: AdminRole; label: string; email: string }[] = [
  { role: "admin", label: "Studio admin", email: "maya@yogasadhana.sg" },
  { role: "instructor", label: "Instructor", email: "priya@yogasadhana.sg" },
];

export default function LoginPage() {
  const router = useRouter();
  const adminUsers = useAdminState((s) => s.adminUsers);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  function handleSignIn(e: React.FormEvent) {
    e.preventDefault();
    const user = adminUsers.find(
      (u) => u.role !== "super" && u.email.toLowerCase() === email.toLowerCase(),
    );
    if (user) {
      signInAs(user.id);
      router.push(roleHome[user.role]);
      return;
    }
    const fallback = adminUsers.find((u) => u.role === "admin");
    if (fallback) {
      signInAs(fallback.id);
      router.push(roleHome[fallback.role]);
    }
  }

  function fill(role: AdminRole) {
    const acc = demoAccounts.find((a) => a.role === role);
    if (!acc) return;
    setEmail(acc.email);
    setPassword(DEMO_PASSWORD);
  }

  return (
    <main className="mx-auto max-w-md p-8">
      <h1 className="text-2xl font-semibold text-ink">Sign in</h1>
      <p className="mt-1 text-sm text-muted">
        Mock auth for development. Use any email + password, or pick a demo account below.
      </p>

      <div className="mt-6 rounded-lg border border-border bg-card p-4">
        <p className="text-xs font-medium uppercase tracking-wide text-muted">Demo accounts</p>
        <ul className="mt-3 space-y-2">
          {demoAccounts.map((a) => (
            <li
              key={a.role}
              className="flex items-center justify-between gap-3 rounded-md border border-border bg-paper p-3"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium text-ink">{a.label}</p>
                <p className="truncate font-mono text-xs text-muted">
                  {a.email} · {DEMO_PASSWORD}
                </p>
              </div>
              <Button type="button" variant="ghost" size="sm" onClick={() => fill(a.role)}>
                Use
              </Button>
            </li>
          ))}
        </ul>
      </div>

      <form className="mt-6 space-y-4" onSubmit={handleSignIn}>
        <div className="space-y-1.5">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <Button type="submit" className="w-full">
          Continue
        </Button>
      </form>
    </main>
  );
}
