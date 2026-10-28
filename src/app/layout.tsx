import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "SCALP-OS // Terminal de Scalping — Modo Real",
  description:
    "Motor autónomo de scalping en Binance Spot. Modo real estricto, cero simulación. Take Profit +1.5% · Stop Loss −1.0% · Max Wait 60s.",
};

export const viewport: Viewport = {
  themeColor: "#04060a",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es">
      <body className="min-h-dvh bg-[#04060a] text-zinc-100 antialiased">{children}</body>
    </html>
  );
}
