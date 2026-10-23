import type { Metadata } from "next";
import Dashboard from "@/components/Dashboard/Dashboard";
import { householdTimezone } from "@/lib/time";

export const metadata: Metadata = {
  title: "Today",
  manifest: "/capture.webmanifest",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "Household" },
  icons: { apple: "/icons/capture-180.png" },
};

export const dynamic = "force-dynamic";

/**
 * The wall display, in a pocket.
 *
 * Its own route rather than a query string, but deliberately NOT its own
 * installed app: it carries the phone manifest so that walking here from
 * Capture stays inside the same home-screen app. The wall's manifest asks for
 * landscape and fullscreen, which is the wrong shape for a phone.
 */
export default function TodayPage() {
  return <Dashboard timeZone={householdTimezone()} variant="phone" />;
}
