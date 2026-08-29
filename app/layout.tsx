import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "IPO Fast Check",
  description: "Check multiple IPO allotments and current GMP in one simple tool."
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
