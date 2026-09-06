import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "IPO Fast Check",
  description: "Check recent IPO allotment results and current GMP in one simple tool.",
  icons: {
    icon: [{ url: "/icon.svg", type: "image/svg+xml" }],
    shortcut: "/icon.svg"
  }
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
