"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { signInAdmin, listSeededAdmins } from "@/lib/mock-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function AdminLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const seeded = listSeededAdmins();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const result = signInAdmin(email.trim());
    if (!result) {
      setError("No seeded admin with that email. Try one of the hints below.");
      return;
    }
    router.push("/");
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-paper px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex h-12 w-12 rounded-full bg-accent text-paper items-center justify-center font-extrabold mb-3">
            YS
          </div>
          <h1 className="text-2xl font-extrabold tracking-tight text-ink">Yoga Sadhana Admin</h1>
          <p className="text-sm text-muted mt-1">Sign in to continue.</p>
        </div>
        <form onSubmit={handleSubmit} className="rounded-xl bg-card border border-border shadow-soft p-6 space-y-4">
          <div>
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="priya@yogasadhana.sg"
              required
            />
          </div>
          <div>
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
            />
            <p className="text-xs text-muted mt-1 font-mono">Mockup — any password works.</p>
          </div>
          {error ? <p className="text-sm text-error">{error}</p> : null}
          <Button type="submit" className="w-full" size="lg">Sign in</Button>
        </form>
        <div className="mt-6 rounded-lg bg-warm border border-border px-4 py-3">
          <p className="text-xs uppercase tracking-wider text-muted font-semibold mb-2">Seeded admins</p>
          <ul className="space-y-1">
            {seeded.map((u) => (
              <li key={u.id} className="text-xs font-mono text-ink">
                {u.email} — {u.firstName} {u.lastName}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </main>
  );
}
