"use client";

import Link from "next/link";
import { CalendarPlus, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { ComingUp } from "@/components/account/coming-up";
import { AccountHeader } from "@/components/account/account-header";
import { ACCOUNT_SECTIONS } from "@/components/account/account-nav-items";
import { SignOutButton } from "@/components/account/sign-out-button";
import { OpenPurchases } from "@/components/account/open-purchases";
import { CancelledBanner } from "@/components/checkout/cancelled-banner";
import { BTN_BOOK, CARD } from "@/components/ui/styles";
import { useAppUser } from "@/lib/auth";
import { useHoldLoader } from "@/lib/loading-store";
import { usePartPaymentOptions, useOpenPurchases } from "@/lib/open-purchases";
import { overviewLine } from "@/lib/practice";
import { usePracticeMonth } from "@/lib/use-practice";

/**
 * The account's landing page: a line to My practice under the greeting, the
 * one booking the member walks into next ("Up next"), then — below `lg`, where
 * there is no sidebar — the account menu. Everything else has its own page: My
 * bookings, My practice, My packages, Merch, Profile & security, General settings.
 */
export default function AccountHome() {
  const { user } = useAppUser();
  // A balance the member left outstanding (#93), and the return from a payment
  // page they left (#274): the checkout's cancel URLs land here.
  const {
    purchases: openPurchases,
    failed: openPurchasesFailed,
    loading: openPurchasesLoading,
  } = useOpenPurchases();
  const partPayment = usePartPaymentOptions();
  // A balance owed sits above Up next: the page waits for it rather than be
  // pushed down when it lands.
  useHoldLoader(openPurchasesLoading || partPayment.loading);
  const firstName = user?.firstName || "there";

  return (
    <div className="max-w-3xl">
      <header className="mb-5 md:mb-6 flex items-center justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-muted">Welcome back</p>
          <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight text-ink truncate">Hi, {firstName}</h1>
          <PracticeLine />
        </div>
        <Link href="/" className={cn(BTN_BOOK, "hidden sm:inline-flex min-h-[44px]")}>
          <CalendarPlus className="h-4 w-4" aria-hidden />
          Book a class
        </Link>
      </header>

      <CancelledBanner className="mb-6" />

      <div className="mb-6 empty:hidden [&>*:first-child]:mt-0">
        <OpenPurchases purchases={openPurchases} partPayment={partPayment} failed={openPurchasesFailed} />
      </div>

      <ComingUp />

      <AccountMenu />
    </div>
  );
}

/**
 * "164 sessions · 13 this month ›" under the greeting, to My practice. It sits
 * above everything else, so the page waits for it rather than shift when it
 * lands; nothing is drawn before the member's first session, or if the read fails.
 */
function PracticeLine() {
  const { summary, loading } = usePracticeMonth();
  useHoldLoader(loading);
  const line = summary && overviewLine(summary);
  if (!line) return null;
  return (
    <Link
      href="/account/practice"
      className="mt-1 inline-flex min-h-[32px] items-center gap-0.5 text-sm font-semibold text-accent-deep hover:text-accent"
    >
      {line}
      <ChevronRight className="h-4 w-4" aria-hidden />
    </Link>
  );
}

/** The account's sections as a menu, for phones and tablets where there is no sidebar. */
function AccountMenu() {
  return (
    <section aria-labelledby="account-menu-heading" className="lg:hidden">
      <h2 id="account-menu-heading" className="mb-3 text-base font-bold text-ink">
        My account
      </h2>
      <div className={cn(CARD, "overflow-hidden")}>
        <Link
          href="/account/profile"
          className="flex items-center justify-between gap-3 p-4 border-b border-ink/5 hover:bg-ink/[0.02] transition-colors"
        >
          <AccountHeader size="lg" />
          <ChevronRight className="h-5 w-5 shrink-0 text-muted" />
        </Link>
        <nav aria-label="Account">
          <ul className="divide-y divide-ink/5">
            {ACCOUNT_SECTIONS.map(({ href, label, hint, icon: Icon }) => (
              <li key={href}>
                <Link
                  href={href}
                  className="flex items-center gap-3 px-4 py-3 min-h-[60px] hover:bg-ink/[0.02] transition-colors"
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent/8 text-accent-deep">
                    <Icon className="h-[18px] w-[18px]" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold text-ink">{label}</span>
                    <span className="block text-xs text-muted truncate">{hint}</span>
                  </span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted" />
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>
      <SignOutButton className="mt-3 flex w-full items-center justify-center gap-2 rounded-2xl border border-error/30 bg-card min-h-[52px] text-sm font-semibold text-error hover:bg-error/5 transition-colors" />
    </section>
  );
}
