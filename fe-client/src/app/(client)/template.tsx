import { PageTransition } from "@/components/layout/page-transition";

/** Every member page arrives the same way (`components/layout/page-transition.tsx`). */
export default function ClientTemplate({ children }: { children: React.ReactNode }) {
  return <PageTransition>{children}</PageTransition>;
}
