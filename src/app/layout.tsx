import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "FitChat",
  description: "Your AI fitness training partner",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "FitChat",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0a0a0a",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="h-full">
      <body className="h-full bg-neutral-950 text-neutral-50 antialiased">
        {children}
      </body>
    </html>
  );
}
