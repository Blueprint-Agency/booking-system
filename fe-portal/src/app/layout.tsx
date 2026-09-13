import type { Metadata } from "next";
import { Manrope } from "next/font/google";
import { headers } from "next/headers";
import { Toaster } from "sonner";
import { getBrand } from "@/lib/brand";
import { isSuperPortalHost } from "@/lib/tenant-host";
import { BrandProvider } from "@/components/brand/brand-provider";
import { PlatformAuthProvider } from "@/components/platform/platform-auth-provider";
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

  const page = (
    <html lang="en" className={sans.variable}>
      <body className="font-sans antialiased bg-paper text-ink">
        <BrandProvider brand={brand}>{children}</BrandProvider>
        <Toaster position="top-right" richColors />
      </body>
    </html>
  );

  // Two products, two sign-ins, told apart by hostname. A studio's portal holds
  // a Better Auth staff session (`lib/staff-auth.ts`) and needs no provider; the
  // super portal is still on Clerk until #116.
  return isSuperPortalHost(host) ? (
    <PlatformAuthProvider host={host}>{page}</PlatformAuthProvider>
  ) : (
    page
  );
}
