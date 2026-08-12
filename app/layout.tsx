import type { Metadata } from "next";
import { Newsreader, Inter, IBM_Plex_Mono } from "next/font/google";
import { appUrl, SITE_NAME, SITE_TITLE, SITE_DESCRIPTION } from "@/lib/seo";
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
  // Without metadataBase, Next resolves OG/Twitter image URLs against localhost
  // and warns at build. Every absolute URL in the head derives from this.
  metadataBase: new URL(appUrl),
  title: {
    default: SITE_TITLE,
    // Sub-pages set a bare title ("Privacy") and inherit the suffix, so the
    // brand can be renamed in one place.
    template: `%s — ${SITE_NAME}`,
  },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  openGraph: {
    type: "website",
    siteName: SITE_NAME,
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
  },
  twitter: {
    card: "summary_large_image",
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${serif.variable} ${sans.variable} ${mono.variable}`}>
      <body className="font-sans min-h-screen">{children}</body>
    </html>
  );
}
