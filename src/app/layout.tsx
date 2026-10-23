import type { Metadata, Viewport } from "next";
import { Fraunces, Instrument_Sans } from "next/font/google";
import ServiceWorker from "@/components/ServiceWorker";
import "@/styles/globals.css";

// Fraunces for anything you read from across the room — it has enough
// character to stop the wall display looking like an admin panel. Instrument
// Sans does the working text.
const display = Fraunces({
  subsets: ["latin"],
  // Variable font: the axes come from the file, so no static weight list.
  axes: ["SOFT", "WONK", "opsz"],
  variable: "--font-display",
  display: "swap",
});

const sans = Instrument_Sans({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Household",
  description: "Two phones, one wall display, one household.",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "Household" },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: "#f7f3ec",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-AU" className={`${display.variable} ${sans.variable}`}>
      <body>
        {children}
        <ServiceWorker />
      </body>
    </html>
  );
}
