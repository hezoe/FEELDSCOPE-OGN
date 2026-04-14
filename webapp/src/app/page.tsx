"use client";

import dynamic from "next/dynamic";
import Navigation from "@/components/Navigation";
import { useTab } from "@/lib/TabContext";
import SettingsPage from "@/app/settings/page";
import OgnPage from "@/app/ogn/page";
import AircraftDbPage from "@/app/aircraft-db/page";

const FlightMap = dynamic(() => import("@/components/FlightMap"), {
  ssr: false,
  loading: () => (
    <div
      className="flex items-center justify-center flex-1"
      style={{ background: "var(--color-bg-primary)", color: "var(--color-text-secondary)" }}
    >
      地図を読み込み中...
    </div>
  ),
});

export default function Home() {
  const { activeTab } = useTab();

  return (
    <div className="flex flex-col h-screen p-1.5 gap-1.5" style={{ background: "var(--color-bg-primary)" }}>
      <Navigation />

      {/* FlightMap: always mounted, hidden via CSS when not active */}
      <div
        className="flex flex-col flex-1 min-h-0 gap-1.5"
        style={{ display: activeTab === "map" ? "flex" : "none" }}
      >
        <FlightMap />
      </div>

      {activeTab === "settings" && <SettingsPage />}
      {activeTab === "ogn" && <OgnPage />}
      {activeTab === "aircraft-db" && <AircraftDbPage />}
    </div>
  );
}
