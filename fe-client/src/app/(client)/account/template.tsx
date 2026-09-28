import { PageTransition } from "@/components/layout/page-transition";

/**
 * The account area's own template, inside `AccountShell`: moving between
 * account pages animates the panel while the account menu stays still. A
 * quieter entrance than the page's, which it sits inside on the first visit.
 */
export default function AccountTemplate({ children }: { children: React.ReactNode }) {
  return <PageTransition variant="panel">{children}</PageTransition>;
}
