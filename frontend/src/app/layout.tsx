import type { Metadata } from "next";
import { Lexend, Zen_Kaku_Gothic_New } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/providers";
import { Shell } from "@/components/shell";

// Body: Lexend, drawn to reduce reading effort (open shapes, generous spacing).
const body = Lexend({ variable: "--font-body", subsets: ["latin"] });
// Headings and station numbers: a Japanese gothic in the spirit of Tokyo station signs.
const display = Zen_Kaku_Gothic_New({ variable: "--font-display-face", subsets: ["latin"], weight: ["500", "700", "900"] });

export const metadata: Metadata = {
  title: "Tokyo Tourism Insights",
  description: "Find a tourism business worth starting in Tokyo, from official visitor and spending statistics",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${body.variable} ${display.variable} h-full antialiased`}>
      <body className="min-h-full font-sans">
        <Providers>
          <Shell>{children}</Shell>
        </Providers>
      </body>
    </html>
  );
}
