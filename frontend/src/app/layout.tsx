import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";

const inter = Inter({ subsets: ["latin"], variable: "--font-sans" });

export const metadata: Metadata = {
  title: "Robinhood Index Vault",
  description: "Invest in a basket of stock tokens on Robinhood Chain",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="min-h-screen font-sans antialiased">
        <div className="background-orb" aria-hidden="true" />
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
