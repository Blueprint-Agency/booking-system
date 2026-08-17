import type { Metadata } from "next";
import { Manrope } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
import { Toaster } from "sonner";
import "./globals.css";

const sans = Manrope({ subsets: ["latin"], variable: "--font-sans" });

export const metadata: Metadata = {
  title: "Yoga Sadhana — Admin",
  description: "Studio operations console for Yoga Sadhana.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <ClerkProvider
      signInUrl="/login"
      signUpUrl="/signup"
      signInForceRedirectUrl="/admin"
      signUpForceRedirectUrl="/admin"
    >
      <html lang="en" className={sans.variable}>
        <body className="font-sans antialiased bg-paper text-ink">
          {children}
          <Toaster position="top-right" richColors />
        </body>
      </html>
    </ClerkProvider>
  );
}
