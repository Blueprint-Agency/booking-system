"use client";

import { Suspense } from "react";
import { SignUp } from "@clerk/nextjs";
import { useSearchParams } from "next/navigation";
import { AuthSplitShell } from "@/components/auth/auth-split-shell";

function RegisterContent() {
  const searchParams = useSearchParams();
  const next = searchParams.get("next") || "/";

  return (
    <AuthSplitShell
      imageKey="hero-pilates-01"
      quote="Every student begins with a single breath."
    >
      <h1 className="text-3xl font-extrabold tracking-tight text-ink mb-8">
        Create your account
      </h1>
      <SignUp
        forceRedirectUrl={next}
        appearance={{
          elements: {
            rootBox: "w-full",
            card: "shadow-none p-0 bg-transparent",
            headerTitle: "hidden",
            headerSubtitle: "hidden",
            socialButtonsBlockButton:
              "rounded-full border border-ink/10 py-3 text-sm font-medium hover:border-accent transition-colors w-full",
            dividerLine: "bg-ink/10",
            dividerText: "text-muted text-xs",
            formFieldInput:
              "rounded-xl border border-ink/10 bg-paper px-4 py-3 text-sm w-full focus:border-accent focus:outline-none",
            formFieldLabel:
              "text-xs uppercase tracking-wider text-muted mb-2 block",
            formButtonPrimary:
              "w-full rounded-full bg-ink text-paper py-3 text-sm font-medium hover:bg-ink/90 mt-2",
            footerActionLink: "text-accent-deep font-medium",
          },
        }}
      />
    </AuthSplitShell>
  );
}

export default function RegisterPage() {
  return (
    <Suspense fallback={null}>
      <RegisterContent />
    </Suspense>
  );
}
