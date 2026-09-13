import type { ReactNode } from "react";
import { StudioMark } from "@/components/brand/studio-mark";

/** The card every sign-in, set-password and refusal screen sits in. */
export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-paper px-4 py-8 sm:px-6">
      <div className="w-full max-w-md">
        <div className="mb-6 flex items-center justify-center gap-2.5">
          <StudioMark size="auth" badge="Staff" />
        </div>
        <div className="rounded-2xl border border-border bg-card p-6 shadow-soft">
          {children}
        </div>
      </div>
    </div>
  );
}

export function ErrorNote({ message }: { message: string }) {
  return (
    <p className="rounded-lg border border-error/30 bg-error/5 px-3 py-2 text-xs text-error">
      {message}
    </p>
  );
}
