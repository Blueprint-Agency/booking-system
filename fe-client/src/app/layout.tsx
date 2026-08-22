import type { Metadata } from "next";
import { Manrope } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
import { Toaster } from "sonner";
import "./globals.css";

// Self-hosted via next/font (same pattern as fe-portal) — no render-blocking
// request to fonts.googleapis.com on first paint.
const sans = Manrope({ subsets: ["latin"], variable: "--font-sans" });

export const metadata: Metadata = {
  title: "Yoga Sadhana — Singapore Yoga Studio",
  description: "Build strength, improve flexibility, and find balance through yoga at Yoga Sadhana Singapore.",
  icons: {
    icon: "/brand/favicon.jpg",
    apple: "/brand/apple-icon.jpg",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <ClerkProvider
      signInUrl="/login"
      signUpUrl="/register"
      signInFallbackRedirectUrl="/"
      signUpFallbackRedirectUrl="/"
    >
    <html lang="en" className={sans.variable}>
      <body className="antialiased">
        {children}
        <Toaster position="top-center" richColors />
      </body>
    </html>
    </ClerkProvider>
  );
}
