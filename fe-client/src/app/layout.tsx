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
 * The icon falls back to `/brand/platform-mark.svg` only when the studio has
 * supplied none, and that file is the platform's own mark. It used to be tenant
 * #1's logo, which meant every studio without a favicon of its own wore tenant
 * #1's — a fallback must be nobody's branding, never another tenant's.
 *
 * There is no `apple` fallback for the same reason in reverse: an
 * apple-touch-icon is what a member pins to their home screen, so if the studio
 * has supplied nothing there is nothing honest to put there, and the platform
 * mark on a member's home screen would name the wrong business.
 */
export async function generateMetadata(): Promise<Metadata> {
  const brand = await getBrand();
  return {
    title: brand.tagline ? `${brand.name} — ${brand.tagline}` : brand.name,
    description: brand.tagline ?? `Book classes, workshops and private sessions at ${brand.name}.`,
    icons: {
      icon: brand.faviconUrl ?? "/brand/platform-mark.svg",
      ...(brand.faviconUrl ? { apple: brand.faviconUrl } : {}),
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
