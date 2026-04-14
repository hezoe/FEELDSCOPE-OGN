"use client";

import { createContext, useContext, useState, type ReactNode } from "react";

export type TabId = "map" | "status" | "settings" | "ogn" | "aircraft-db";

interface TabContextValue {
  activeTab: TabId;
  setActiveTab: (tab: TabId) => void;
}

const TabContext = createContext<TabContextValue>({
  activeTab: "map",
  setActiveTab: () => {},
});

export function TabProvider({ children }: { children: ReactNode }) {
  const [activeTab, setActiveTab] = useState<TabId>("map");
  return (
    <TabContext.Provider value={{ activeTab, setActiveTab }}>
      {children}
    </TabContext.Provider>
  );
}

export function useTab() {
  return useContext(TabContext);
}
