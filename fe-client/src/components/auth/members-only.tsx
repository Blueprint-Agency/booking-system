import Link from "next/link";
import { Lock } from "lucide-react";
import { BTN_PRIMARY, BTN_SECONDARY, CARD } from "@/components/ui/styles";

/**
 * Stands in for a page whose content is for members only — workshops, whose
 * details the API gives no signed-out visitor. Says nothing about what is
 * behind it; signing up or logging in brings the visitor back to `nextHref`.
 */
export function MembersOnly({ title, description, nextHref }: {
  title: string;
  description: string;
  nextHref: string;
}) {
  const next = encodeURIComponent(nextHref);
  return (
    <div className={CARD}>
      <div className="px-6 py-12 text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-warm">
          <Lock className="h-6 w-6 text-muted" aria-hidden />
        </div>
        <h2 className="text-base font-semibold text-ink">{title}</h2>
        <p className="mx-auto mt-1 max-w-sm text-sm text-muted">{description}</p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <Link href={`/register?next=${next}`} className={BTN_PRIMARY}>
            Sign up
          </Link>
          <Link href={`/login?next=${next}`} className={BTN_SECONDARY}>
            Log in
          </Link>
        </div>
      </div>
    </div>
  );
}
