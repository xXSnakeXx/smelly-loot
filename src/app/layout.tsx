import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

// Brand fonts. Geist is Vercel's modern variable font; Geist Mono is its
// monospace counterpart. Both are loaded via `next/font/google` so they are
// self-hosted at build time and don't trigger external CSS imports at runtime.
const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Smelly Loot",
  description:
    "Self-hosted loot distribution tool for FF XIV savage raid statics.",
};

/**
 * Root layout for the entire application.
 *
 * Locale-aware rendering will be wired up once next-intl is integrated; for
 * now the document language is fixed to English. The layout intentionally
 * stays minimal so individual route segments can compose their own chrome.
 */
export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
