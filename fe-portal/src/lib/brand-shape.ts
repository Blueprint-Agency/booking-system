/**
 * The shape of a studio's branding, and the neutral identity to fall back to.
 *
 * Split from `lib/brand.ts` for one reason: that module reads the request's own
 * `Host` through `next/headers`, which makes it server-only, and the client
 * components that *render* branding still need the type and the fallback. A
 * `"use client"` file importing `PLATFORM_BRAND` from there pulls `next/headers`
 * into the browser bundle, and the build refuses it — correctly, since there is
 * no request to read on the client.
 *
 * So the environment-free half lives here, imported by both sides. Nothing in
 * this file may reach for a request, a header, or the network.
 */

export interface Brand {
  /** The studio's name, as its members know it. Never empty. */
  name: string;
  /** One line under the name, where a surface has room for one. */
  tagline: string | null;
  /** A wordmark to render instead of the name, when the studio supplied one. */
  logoUrl: string | null;
  faviconUrl: string | null;
  /** The image behind the sign-in split, and the social card. */
  ogImageUrl: string | null;
  /** Theme tokens the studio overrides; unset keys fall through to the CSS. */
  theme: Record<string, string>;
  /** Overridable strings, keyed by surface. */
  copy: Record<string, string>;
  /**
   * The studio's IANA time zone (`tenants.timezone`, from the slug lookup). Every
   * date and time on screen, and every time typed into the portal, is read on
   * this clock, not the browser's, through `lib/studio-time.ts`. Null where
   * there is no studio: the super portal's own hostname has no clock, and
   * nothing may format in UTC or the browser's zone in its place
   * (`useStudioZone` refuses).
   */
  timezone: string | null;
}

/**
 * What the app renders when no Tenant is resolved at all — the bare root
 * domain, a preview URL, the super portal's own hostname.
 *
 * Named for the platform, because in that state there is no studio to name.
 */
export const PLATFORM_BRAND: Brand = {
  name: "ReserveToday",
  tagline: null,
  logoUrl: null,
  faviconUrl: null,
  ogImageUrl: null,
  theme: {},
  copy: {},
  // No studio, so no clock: reading a date in this state is a bug that shows.
  timezone: null,
};
