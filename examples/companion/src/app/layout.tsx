import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Charivo Companion",
  description:
    "Minimal companion demo using the Charivo realtime session hook.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
