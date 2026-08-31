"use client";

/**
 * The studio's branding, made reachable from the client components that render
 * it — the top bar, the sign-in split, every place the name appears.
 *
 * Resolution is a *server* concern (`lib/brand.ts` reads the request's Host), so
 * the root layout resolves once and hands the result down through this
 * provider. That keeps the branding on the first paint rather than arriving
 * after a fetch, which matters because the studio's name is in the header of
 * every page: a client-side fetch would flash the platform's name first, which
 * is precisely the thing a studio is paying not to see.
 *
 * `theme` becomes CSS custom properties on a wrapper element, so a studio's
 * colours override `globals.css` without any component knowing they were
 * overridden. A token the studio has not set simply isn't emitted, and the
 * stylesheet's own value stands.
 */
import { createContext, useContext, useMemo } from "react";
import type { Brand } from "@/lib/brand";
import { PLATFORM_BRAND } from "@/lib/brand";

const BrandContext = createContext<Brand>(PLATFORM_BRAND);

/**
 * The studio being rendered. Never null — outside a provider, or on a hostname
 * that names no studio, this is the platform's neutral identity.
 */
export function useBrand(): Brand {
  return useContext(BrandContext);
}

/**
 * One overridable string, by key, falling back to the copy written here.
 *
 * The fallback is an argument rather than a lookup table because the sentence
 * belongs next to the component that says it — a table of default copy is a
 * second place for the words to live and a first place for them to drift.
 */
export function useBrandCopy(key: string, fallback: string): string {
  const brand = useBrand();
  return brand.copy[key]?.trim() || fallback;
}

/**
 * Only tokens the studio actually set — anything else must fall through.
 *
 * A key is emitted verbatim with a `--` prefix, so it has to be the name the
 * stylesheet already uses: `color-accent`, not `accent`. That is deliberate —
 * a mapping layer here would be a second list of token names to keep in step
 * with `globals.css`, and the one that drifts is the one nobody edits.
 */
function themeStyle(theme: Record<string, string>): React.CSSProperties {
  const style: Record<string, string> = {};
  for (const [token, value] of Object.entries(theme)) {
    // Keys arrive from a studio's own settings, so they are named rather than
    // trusted: anything that isn't a plain token name is ignored instead of
    // being interpolated into a style attribute.
    if (!/^[a-z0-9-]+$/i.test(token)) continue;
    if (typeof value !== "string" || !value.trim()) continue;
    style[`--${token}`] = value.trim();
  }
  return style as React.CSSProperties;
}

export function BrandProvider({
  brand,
  children,
}: {
  brand: Brand;
  children: React.ReactNode;
}) {
  const style = useMemo(() => themeStyle(brand.theme), [brand.theme]);
  return (
    <BrandContext.Provider value={brand}>
      <div style={style} className="contents">
        {children}
      </div>
    </BrandContext.Provider>
  );
}
