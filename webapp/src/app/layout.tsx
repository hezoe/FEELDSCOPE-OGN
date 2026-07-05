import type { Metadata } from "next";
import "./globals.css";
import { UnitProvider } from "@/lib/UnitContext";
import { TabProvider } from "@/lib/TabContext";
import { PointerTrackerProvider } from "@/lib/PointerTracker";

export const metadata: Metadata = {
  title: "FEELDSCOPE - OGN Flight Monitor",
  description: "OGN FLARM リアルタイムフライトモニター",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja">
      <head>
        <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
      </head>
      <body>
        <TabProvider>
          <UnitProvider>
            <PointerTrackerProvider>
              {children}
            </PointerTrackerProvider>
          </UnitProvider>
        </TabProvider>
      </body>
    </html>
  );
}
