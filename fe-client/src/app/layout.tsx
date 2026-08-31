import type { Metadata } from "next";
import { Manrope } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
import { Toaster } from "sonner";
import { getBrand } from "@/lib/brand";
import { BrandProvider } from "@/components/brand/brand-provider";
import "./globals.css";

// Self-hosted via next/font (same pattern as fe-portal) — no render-blocking
// request to fonts.googleapis.com on first paint.
const sans = Manrope({ subsets: ["latin"], variable: "--font-sans" });

/**
 * The tab title, the description and the icons are the studio's, resolved from
 * the request's hostname (`lib/brand.ts`). Static metadata here would put one
 * studio's name in every other studio's browser tab, which is the visible half
 * of #66.
 *
 * The icons fall back to the files in `/public/brand` only when the studio has
 * supplied none — those are the platform's, not a studio's.
 */
export async function generateMetadata(): Promise<Metadata> {
  const brand = await getBrand();
  return {
    title: brand.tagline ? `${brand.name} — ${brand.tagline}` : brand.name,
    description: brand.tagline ?? `Book classes, workshops and private sessions at ${brand.name}.`,
    icons: {
      icon: brand.faviconUrl ?? "/brand/favicon.jpg",
      apple: brand.faviconUrl ?? "/brand/apple-icon.jpg",
    },
    ...(brand.ogImageUrl ? { openGraph: { images: [brand.ogImageUrl] } } : {}),
  };
}

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Resolved once, on the server, and handed to the client components that
  // render it — so the studio's name is on the first paint rather than
  // replacing the platform's after a fetch.
  const brand = await getBrand();

  return (
    <ClerkProvider
      signInUrl="/login"
      signUpUrl="/register"
      signInFallbackRedirectUrl="/"
      signUpFallbackRedirectUrl="/"
    >
    <html lang="en" className={sans.variable}>
      <body className="antialiased">
        <BrandProvider brand={brand}>{children}</BrandProvider>
        <Toaster position="top-center" richColors />
      </body>
    </html>
    </ClerkProvider>
  );
}
