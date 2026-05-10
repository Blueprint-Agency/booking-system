import Link from "next/link";
import { Button } from "@/components/ui";

export default function LoginPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-paper px-6">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-8 shadow-soft">
        <div className="mb-6 flex items-center gap-2">
          <span className="grid h-9 w-9 place-items-center rounded-lg bg-accent text-sm font-bold text-white">
            YS
          </span>
          <div className="text-base font-semibold text-ink">Yoga Sadhana</div>
        </div>
        <h1 className="mb-1 text-xl font-semibold text-ink">Welcome back</h1>
        <p className="mb-6 text-sm text-muted">
          Mock login — Clerk sign-in form goes here in production.
        </p>
        <Link href="/admin/schedule" className="block">
          <Button className="w-full">Continue as Admin</Button>
        </Link>
      </div>
    </div>
  );
}
