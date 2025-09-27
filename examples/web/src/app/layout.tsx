import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Script from "next/script";
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
  title: "Charivo Live2D Demo | Interactive AI Character Framework",
  description:
    "Experience Charivo - a modular Live2D + LLM framework for interactive character experiences. Chat with Hiyori featuring real-time 2D animations, AI conversations, and voice synthesis using OpenAI GPT and Web Speech API.",
  keywords: [
    "Live2D",
    "LLM",
    "AI",
    "Character",
    "Chatbot",
    "TTS",
    "Animation",
    "TypeScript",
    "Framework",
    "Interactive",
    "OpenAI",
    "Voice",
  ],
  authors: [{ name: "Zeikar", url: "https://github.com/zeikar" }],
  creator: "Charivo Framework",
  publisher: "Charivo",
  robots: "index, follow",
  openGraph: {
    title: "Charivo Live2D Demo | Interactive AI Character Framework",
    description:
      "Experience the power of modular Live2D + LLM framework. Build interactive AI characters with animations, voice synthesis, and natural language conversations.",
    type: "website",
    locale: "en_US",
    siteName: "Charivo Framework",
    images: [
      {
        url: "/og-image.png", // 나중에 추가할 수 있는 OG 이미지
        width: 1200,
        height: 630,
        alt: "Charivo Live2D Demo - Interactive AI Character Framework",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Charivo Live2D Demo | Interactive AI Character Framework",
    description:
      "Modular Live2D + LLM framework for interactive character experiences with animations and voice",
    images: ["/og-image.png"],
  },
  manifest: "/manifest.json", // PWA manifest (옵션)
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
        <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />

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
              url: "https://charivo-demo.vercel.app",
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

        {/* Load Live2D Cubism 4 Core (required by pixi-live2d-display/cubism4) */}
        <Script
          src="https://cubism.live2d.com/sdk-web/cubismcore/live2dcubismcore.min.js"
          strategy="beforeInteractive"
        />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
