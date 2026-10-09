import type { Metadata, Viewport } from "next";
import { Anybody, Hanken_Grotesk, Martian_Mono, Rubik_Mono_One } from "next/font/google";
import "./globals.css";

const anybody = Anybody({ subsets: ["latin"], variable: "--font-anybody", display: "swap" });
const rubikMono = Rubik_Mono_One({ subsets: ["latin"], weight: "400", variable: "--font-rubik-mono", display: "swap" });
const martianMono = Martian_Mono({ subsets: ["latin"], variable: "--font-martian-mono", display: "swap" });
const hanken = Hanken_Grotesk({ subsets: ["latin"], variable: "--font-hanken", display: "swap" });

export const metadata: Metadata = {
  title: {
    default: "Blind: private payments on Beldex",
    template: "%s · Blind",
  },
  description:
    "Blind is a payment app on Beldex. Send someone money they can claim with a link, or request payment without publishing your wallet address.",
  applicationName: "Blind",
  referrer: "strict-origin-when-cross-origin",
  robots: { index: true, follow: true },
  openGraph: {
    title: "Blind: private payments on Beldex",
    description: "Latent until claimed. Private payments and payment requests on Beldex.",
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: "#0b0c0d",
  colorScheme: "dark",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${anybody.variable} ${rubikMono.variable} ${martianMono.variable} ${hanken.variable}`}>
      <body>
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:bg-raised focus:px-4 focus:py-2"
        >
          Skip to content
        </a>
        {children}
      </body>
    </html>
  );
}
