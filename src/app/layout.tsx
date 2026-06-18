import type { Metadata } from "next";
import { Montserrat } from "next/font/google";
import "./globals.css";
import { TRPCProvider } from "@/lib/trpc/client";

// Typographie unique du site : Montserrat (variable font, tous les poids).
// Mappée à la fois sur --font-serif (titres) et --font-sans (corps).
const montserrat = Montserrat({
  variable: "--font-montserrat",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "FormA+Super",
  description:
    "Portail interne A⁺SUPER pour accompagner la bascule Auchan → Intermarché : formations, repères et assistant BRAIN.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="fr"
      className={`${montserrat.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col font-sans">
        <TRPCProvider>{children}</TRPCProvider>
      </body>
    </html>
  );
}
