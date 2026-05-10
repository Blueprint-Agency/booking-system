"use client";
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, Loader2, UserCog } from "lucide-react";
import { Button, Input, Label } from "@/components/ui";
import { staffUsers } from "@/data";
import { cn } from "@/lib/utils";

const DEMO_PASSWORD = "yogasadhana2026";

type Preset = {
  key: string;
  label: string;
  staffId: string;
  icon: typeof UserCog;
};

const PRESETS: Preset[] = [
  { key: "admin", label: "Admin", staffId: "stf-admin-1", icon: UserCog },
];

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  function fillPreset(p: Preset) {
    const staff = staffUsers.find((s) => s.id === p.staffId);
    if (!staff) return;
    setEmail(staff.email);
    setPassword(DEMO_PASSWORD);
    setError(null);
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const match = staffUsers.find(
      (s) => s.email.toLowerCase() === email.trim().toLowerCase()
    );
    if (!match) {
      setError("No account matches that email.");
      return;
    }
    if (match.status !== "active") {
      setError("This account has been archived.");
      return;
    }
    if (password !== DEMO_PASSWORD) {
      setError("Incorrect password. Demo password is yogasadhana2026.");
      return;
    }

    setLoading(true);
    if (typeof window !== "undefined") {
      try {
        window.sessionStorage.setItem(
          "ys-admin-session",
          JSON.stringify({
            id: match.id,
            name: match.name,
            email: match.email,
            role: match.role,
            signedInAt: new Date().toISOString(),
          })
        );
      } catch {}
    }
    const dest =
      match.role === "instructor" ? "/admin/schedule" : "/admin/schedule";
    setTimeout(() => router.push(dest), 350);
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-paper px-4 py-8 sm:px-6">
      <div className="w-full max-w-md">
        <div className="mb-6 flex items-center justify-center gap-2.5">
          <span className="grid h-10 w-10 place-items-center rounded-lg bg-accent text-base font-bold text-white shadow-soft">
            YS
          </span>
          <div className="text-lg font-semibold tracking-tight text-ink">
            Yoga Sadhana
            <span className="ml-2 rounded-full bg-card px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted">
              Admin
            </span>
          </div>
        </div>

        <div className="rounded-2xl border border-border bg-card p-6 shadow-soft sm:p-8">
          <h1 className="text-xl font-semibold text-ink">Welcome back</h1>
          <p className="mt-1 text-sm text-muted">
            Sign in to the studio operations console.
          </p>

          <form onSubmit={onSubmit} className="mt-6 space-y-4" noValidate>
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                placeholder="you@yogasadhana.sg"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="password">Password</Label>
                <button
                  type="button"
                  className="text-xs font-medium text-accent hover:underline"
                  onClick={() =>
                    setError("Demo build — password recovery is not wired up.")
                  }
                >
                  Forgot password?
                </button>
              </div>
              <div className="relative">
                <Input
                  id="password"
                  type={showPw ? "text" : "password"}
                  autoComplete="current-password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPw((v) => !v)}
                  aria-label={showPw ? "Hide password" : "Show password"}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-muted hover:bg-paper hover:text-ink"
                >
                  {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            {error && (
              <div
                role="alert"
                className="rounded-md border border-error/30 bg-error/10 px-3 py-2 text-xs font-medium text-error"
              >
                {error}
              </div>
            )}

            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Signing in…
                </>
              ) : (
                "Sign in"
              )}
            </Button>
          </form>

          <div className="mt-6 border-t border-dashed border-border pt-5">
            <div className="mb-2.5 flex items-center justify-between">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted">
                Demo presets
              </span>
              <span className="font-mono text-[10px] text-muted">
                pw: {DEMO_PASSWORD}
              </span>
            </div>
            <div className="grid grid-cols-1 gap-2">
              {PRESETS.map((p) => {
                const staff = staffUsers.find((s) => s.id === p.staffId);
                const Icon = p.icon;
                return (
                  <button
                    key={p.key}
                    type="button"
                    onClick={() => fillPreset(p)}
                    className={cn(
                      "group flex items-center gap-3 rounded-lg border border-border bg-paper px-3 py-2.5 text-left transition-colors",
                      "hover:border-accent/40 hover:bg-accent/5"
                    )}
                  >
                    <Icon className="h-4 w-4 shrink-0 text-accent" />
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-semibold text-ink">{p.label}</div>
                      <div className="truncate text-[10px] text-muted">
                        {staff?.name} · {staff?.email}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
            <p className="mt-3 text-[11px] leading-snug text-muted">
              Click a preset to autofill the form, then press <span className="font-medium text-ink">Sign in</span>. Demo build — no real auth.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
