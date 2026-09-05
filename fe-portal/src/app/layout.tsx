import type { Metadata } from "next";
import { Manrope } from "next/font/google";
import { headers } from "next/headers";
import { ClerkProvider } from "@clerk/nextjs";
import { Toaster } from "sonner";
import { getBrand } from "@/lib/brand";
import { portalHomePath } from "@/lib/super-portal";
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
  // Two corrections in one. The destination is read from the hostname, because
  // `/admin` is a studio route the super portal has no Tenant to render — and
  // it is a *fallback* rather than a *force*, because the force variant wins
  // over the `?next=` the proxy set on its way to the login page, which is the
  // only record of where the user was actually going.
  const home = portalHomePath(isSuperPortalHost((await headers()).get("host")));

  return (
    <ClerkProvider
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
