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
// From `brand-shape`, not `brand`: the latter reads the request's Host through
// `next/headers` and is server-only, so importing the fallback from there would
// pull that into the browser bundle and fail the build.
import { PLATFORM_BRAND, type Brand } from "@/lib/brand-shape";
import { isKnownZone, requireStudioZone } from "@/lib/studio-time";

const BrandContext = createContext<Brand>(PLATFORM_BRAND);

/**
 * The studio being rendered. Never null — outside a provider, or on a hostname
 * that names no studio, this is the platform's neutral identity.
 */
export function useBrand(): Brand {
  return useContext(BrandContext);
}

/**
 * The studio's time zone, the clock every date and time on screen is read on,
 * and every time typed into the portal means (`lib/studio-time.ts`). Not the
 * browser's: an admin abroad schedules a 19:00 class at 19:00 at the studio.
 * Outside a studio (the super portal's own hostname) there is none, and this
 * throws rather than hand back UTC. A zone this browser does not know never
 * gets here: `BrandProvider` shows `UnknownZoneNotice` in place of the app.
 */
export function useStudioZone(): string {
  return requireStudioZone(useBrand().timezone);
}

/**
 * What stands in for the app when the studio's zone is one this browser does
 * not know (an old WebView without a newer IANA name): every date formatter
 * would throw and the screen go blank, so staff are told why instead.
 */
function UnknownZoneNotice({ name }: { name: string }) {
  return (
    <main className="flex min-h-dvh items-center justify-center px-6 py-16">
      <div className="max-w-md text-center" role="alert">
        <p className="text-lg font-bold tracking-tight text-ink">{name}</p>
        <h1 className="mt-6 text-2xl font-extrabold text-ink">This browser can&apos;t show the studio&apos;s times</h1>
        <p className="mt-2 text-sm text-muted">
          The studio&apos;s time zone is newer than this browser knows. Update your browser or open the portal in
          another one, and times will show as the studio keeps them.
        </p>
      </div>
    </main>
  );
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
  // Asked once, here, before anything below formats a date.
  const zoneUnknown = useMemo(() => brand.timezone !== null && !isKnownZone(brand.timezone), [brand.timezone]);
  return (
    <BrandContext.Provider value={brand}>
      <div style={style} className="contents">
        {zoneUnknown ? <UnknownZoneNotice name={brand.name} /> : children}
      </div>
    </BrandContext.Provider>
  );
}
