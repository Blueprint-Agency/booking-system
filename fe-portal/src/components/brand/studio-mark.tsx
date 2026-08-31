"use client";

/**
 * The studio's identity in the portal chrome: a square mark and the studio's
 * name, in the four places staff see it — both navs, the sign-in screen and the
 * sign-up screen.
 *
 * One component rather than four copies, because the failure it exists to
 * prevent is a *partial* rebrand: three surfaces resolving the Tenant and the
 * fourth still saying the name it was written with. There is now one place that
 * can be wrong, and it is wrong for everyone at once.
 *
 * The mark falls back to initials derived from the name, so a studio that has
 * uploaded no wordmark still gets its own letters and never another studio's.
 */
import { useBrand } from "@/components/brand/brand-provider";

/** An initial per word, capped at three — the mark is a square, not a label. */
export function studioInitials(name: string): string {
  const letters = name
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word[0]!.toUpperCase())
    .join("");
  return letters.slice(0, 3) || "·";
}

export function StudioMark({
  /** Where the mark links to, or nothing when it is not a link. */
  size = "nav",
  /** The pill after the name — "Staff" on the auth screens. */
  badge,
}: {
  size?: "nav" | "auth";
  badge?: string;
}) {
  const brand = useBrand();
  const box = size === "auth" ? "h-10 w-10 text-base" : "h-8 w-8 text-[11px]";
  const gradient =
    size === "auth"
      ? "bg-accent shadow-soft"
      : "bg-gradient-to-br from-accent to-accent-deep shadow-sm transition-transform group-hover:scale-105";

  return (
    <>
      <span
        className={`grid place-items-center rounded-lg font-bold text-white ${box} ${gradient}`}
      >
        {brand.logoUrl ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img src={brand.logoUrl} alt="" className="h-full w-full rounded-lg object-cover" />
        ) : (
          studioInitials(brand.name)
        )}
      </span>
      {size === "auth" ? (
        <div className="text-lg font-semibold tracking-tight text-ink">
          {brand.name}
          {badge ? (
            <span className="ml-2 rounded-full bg-card px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted">
              {badge}
            </span>
          ) : null}
        </div>
      ) : (
        <span className="group-hover:text-accent">{brand.name}</span>
      )}
    </>
  );
}
