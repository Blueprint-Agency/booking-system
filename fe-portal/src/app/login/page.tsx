import { SignIn } from "@clerk/nextjs";

export default function LoginPage() {
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

        <div className="flex justify-center">
          <SignIn
            routing="hash"
            signUpUrl="/signup"
            appearance={{
              elements: {
                rootBox: "w-full",
                card: "rounded-2xl border border-border bg-card shadow-soft",
              },
            }}
          />
        </div>
      </div>
    </div>
  );
}
