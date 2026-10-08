import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { theme } from "@/app.config";
import { Providers } from "@/components/providers";
import { themeCss } from "@/components/ui/tokens";
import "./globals.css";

const sans = Geist({ subsets: ["latin"], variable: "--font-geist-sans" });
const mono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono" });

export const metadata: Metadata = {
  title: { default: "Projstalker API", template: "%s · Projstalker" },
  description: "Backend for the Projstalker social media deep research app",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" suppressHydrationWarning data-scroll-behavior="smooth" className={`${sans.variable} ${mono.variable}`}>
      <body>
        {/* The theme from app.config, over the defaults in globals.css. */}
        {theme && <style dangerouslySetInnerHTML={{ __html: themeCss(theme) }} />}
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
