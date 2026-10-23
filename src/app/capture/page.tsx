import type { Metadata } from "next";
import CaptureScreen from "@/components/Capture/CaptureScreen";

export const metadata: Metadata = {
  title: "Household",
  manifest: "/capture.webmanifest",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "Household" },
  icons: { apple: "/icons/capture-180.png" },
};

export default function CapturePage() {
  return <CaptureScreen />;
}
