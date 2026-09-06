import type { Metadata } from "next";
import { Manrope } from "next/font/google";
import { headers } from "next/headers";
import { ClerkProvider } from "@clerk/nextjs";
import { Toaster } from "sonner";
import { getBrand } from "@/lib/brand";
import { portalHomePath } from "@/lib/super-portal";
import { portalPublishableKey } from "@/lib/clerk-keys";
import { isSuperPortalHost } from "@/lib/tenant-host";
import { BrandProvider } from "@/components/brand/brand-provider";
import "./globals.css";

const sans = Manrope({ subsets: ["latin"], variable: "--font-sans" });

/**
 * The tab title is the studio's, resolved from the request's hostname
 * (`lib/brand.ts`). A staff member with two studios open has two tabs, and they
 * have to be tellable apart.
 */
export async function generateMetadata(): Promise<Metadata> {
  const brand = await getBrand();
  return {
    title: `${brand.name} — Admin`,
    description: `Studio operations console for ${brand.name}.`,
    ...(brand.faviconUrl ? { icons: { icon: brand.faviconUrl } } : {}),
  };
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const brand = await getBrand();
  const host = (await headers()).get("host");
  const superPortal = isSuperPortalHost(host);
  // Two corrections in one. The destination is read from the hostname, because
  // `/admin` is a studio route the super portal has no Tenant to render — and
  // it is a *fallback* rather than a *force*, because the force variant wins
  // over the `?next=` the proxy set on its way to the login page, which is the
  // only record of where the user was actually going.
  const home = portalHomePath(superPortal);

  return (
    <ClerkProvider
      // The hostname picks the Clerk application, and this is the whole of what
      // keeps the super portal's session separate from a studio portal's.
      //
      // Clerk scopes its session cookie (`__client`) to the instance's own
      // Frontend API host, so one Clerk application across two hostnames is one
      // signed-in person across both — signing into `admin.portal.…` signs you
      // into every `{slug}.portal.…` as the same account. Two applications means
      // two Frontend API hosts, two `__client` cookies, two sessions in one
      // browser.
      //
      // Unset falls back to the staff key, which is the behaviour that shipped
      // before this: one shared session, still gated at the API by
      // `PLATFORM_ADMIN_EMAILS`. The server-side half of this split is the
      // `clerkMiddleware` options callback in `proxy.ts`; both read
      // `lib/clerk-keys.ts` so they cannot disagree.
      publishableKey={portalPublishableKey(host)}
      signInUrl="/login"
      signUpUrl="/signup"
      signInFallbackRedirectUrl={home}
      signUpFallbackRedirectUrl={home}
    >
      <html lang="en" className={sans.variable}>
        <body className="font-sans antialiased bg-paper text-ink">
          <BrandProvider brand={brand}>{children}</BrandProvider>
          <Toaster position="top-right" richColors />
        </body>
      </html>
    </ClerkProvider>
  );
}
