import type { Metadata } from "next";
import { Manrope } from "next/font/google";
import { Toaster } from "sonner";
import { getBrand } from "@/lib/brand";
import { BrandProvider } from "@/components/brand/brand-provider";
import { TelemetryUser } from "@/components/telemetry-user";
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

/**
 * No auth provider: both products hold a Better Auth session as a bearer token
 * in the page's own storage (`lib/portal-auth.ts`), which needs none.
 */
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const brand = await getBrand();

  return (
    <html lang="en" className={sans.variable}>
      <body className="font-sans antialiased bg-paper text-ink">
        <BrandProvider brand={brand}>{children}</BrandProvider>
        <TelemetryUser />
        <Toaster position="top-right" richColors />
      </body>
    </html>
  );
}
