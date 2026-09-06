import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  // Required for the opengraph-image file convention: without it Next resolves
  // the social image against localhost. Same origin the sitemap already uses.
  metadataBase: new URL("https://charivo.vercel.app"),
  title: "Charivo Live2D Demo | Interactive AI Character Framework",
  description:
    "Talk to Live2D characters by voice or text. The AI drives expression, motion, gaze, and lip-sync — built on Charivo, a modular TypeScript framework.",
  keywords: [
    "Live2D",
    "LLM",
    "AI",
    "Character",
    "Chatbot",
    "TTS",
    "STT",
    "Animation",
    "TypeScript",
    "Framework",
    "Interactive",
    "OpenAI",
    "Gemini",
    "Realtime Voice",
    "Lip Sync",
  ],
  authors: [{ name: "Zeikar", url: "https://github.com/zeikar" }],
  creator: "Charivo Framework",
  publisher: "Charivo",
  robots: "index, follow",
  openGraph: {
    title: "Charivo Live2D Demo | Interactive AI Character Framework",
    description:
      "Build interactive AI characters with expression, motion, gaze, and lip-sync — over Gemini or OpenAI for chat, speech, and realtime voice.",
    type: "website",
    locale: "en_US",
    siteName: "Charivo Framework",
  },
  twitter: {
    card: "summary_large_image",
    title: "Charivo Live2D Demo | Interactive AI Character Framework",
    description:
      "Live2D AI characters that talk, react, and look at you — a modular TypeScript framework",
    creator: "@zeikar_dev",
  },
  manifest: "/manifest.json", // PWA manifest (optional)
  category: "developer",
  other: {
    "msapplication-TileColor": "#3b82f6",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#3b82f6",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        {/* Favicons and App Icons */}
        <link rel="icon" href="/favicon.ico" sizes="any" />
        <link
          rel="icon"
          href="/icons/favicon-16x16.png"
          sizes="16x16"
          type="image/png"
        />
        <link
          rel="icon"
          href="/icons/favicon-32x32.png"
          sizes="32x32"
          type="image/png"
        />
        <link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />

        {/* Structured Data */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "WebApplication",
              name: "Charivo Live2D Demo",
              description:
                "Interactive demonstration of Charivo framework - a modular Live2D + LLM system for building AI characters with animations, voice synthesis, and natural language conversations",
              url: "https://charivo.vercel.app",
              applicationCategory: "DeveloperApplication",
              operatingSystem: "Web Browser",
              programmingLanguage: "TypeScript",
              offers: {
                "@type": "Offer",
                price: "0",
                priceCurrency: "USD",
              },
              creator: {
                "@type": "Person",
                name: "Zeikar",
                url: "https://github.com/zeikar",
              },
              sourceOrganization: {
                "@type": "Organization",
                name: "Charivo Framework",
                url: "https://github.com/zeikar/charivo",
              },
            }),
          }}
        />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
        <Analytics />
      </body>
    </html>
  );
}
