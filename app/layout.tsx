import type { Metadata } from "next";
import { Newsreader, Inter, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";

const serif = Newsreader({
  subsets: ["latin"],
  style: ["normal", "italic"],
  variable: "--font-serif",
  adjustFontFallback: false,
});
const sans = Inter({ subsets: ["latin"], variable: "--font-sans" });
const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-mono",
});

export const metadata: Metadata = {
  title: {
    // The blue link in a Google result. Under 60 characters so it isn't cut off.
    default: "Founder Brief | Your startup, every morning, in 30 seconds.",
    // Sub-pages set a bare title ("Privacy") and inherit the suffix.
    template: "%s | Founder Brief",
  },
  // The grey subtext under it. ~150 characters is what Google will show.
  description:
    "A daily brief for early-stage founders. Reads your GitHub, Stripe, Supabase and analytics overnight, then tells you what happened and what to do today.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${serif.variable} ${sans.variable} ${mono.variable}`}>
      <body className="font-sans min-h-screen">{children}</body>
    </html>
  );
}
