import type { Metadata } from "next";
import Dashboard from "@/components/Dashboard/Dashboard";
import { householdTimezone } from "@/lib/time";

export const metadata: Metadata = {
  title: "Household Dashboard",
  manifest: "/dashboard.webmanifest",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "Household" },
  icons: { apple: "/icons/dashboard-180.png" },
};

export const dynamic = "force-dynamic";

export default function DashboardPage() {
  // The household's timezone is server configuration, not the tablet's clock.
  return <Dashboard timeZone={householdTimezone()} />;
}
