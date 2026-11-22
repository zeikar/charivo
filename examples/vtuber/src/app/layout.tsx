import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Charivo VTuber",
  description: "An autonomous AI VTuber built on the Charivo public API.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        style={{
          fontFamily:
            'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
        }}
      >
        {children}
      </body>
    </html>
  );
}
