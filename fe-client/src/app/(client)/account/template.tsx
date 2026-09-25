import { PageTransition } from "@/components/layout/page-transition";

/**
 * The account area's own template, inside `AccountShell`: moving between
 * account pages animates the panel while the account menu stays still.
 */
export default function AccountTemplate({ children }: { children: React.ReactNode }) {
  return <PageTransition>{children}</PageTransition>;
}
