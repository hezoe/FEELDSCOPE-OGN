"use client";

import React, { useState, useEffect, useRef } from "react";
import { useUnits } from "@/lib/UnitContext";
import { useTab, type TabId } from "@/lib/TabContext";
import { openHelpTab, type HelpTab } from "./HelpHint";

export default function Navigation() {
  const { activeTab, setActiveTab } = useTab();
  const [clock, setClock] = useState("--:--:--");
  const { units } = useUnits();

  useEffect(() => {
    const update = () => {
      const now = new Date();
      setClock(
        now.toLocaleTimeString("ja-JP", {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          hour12: false,
        })
      );
    };
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <header
      className="flex items-center shrink-0 rounded-md"
      style={{
        background: "var(--color-bg-secondary)",
        border: "1px solid var(--color-border)",
        boxShadow: "0 1px 2px rgba(0,0,0,0.06)",
        height: 40,
      }}
    >
      {/* App title */}
      <div
        className="flex items-center gap-3 px-5 h-full shrink-0"
        style={{ borderRight: "1px solid var(--color-border)" }}
      >
        <span className="text-sm font-bold tracking-wider" style={{ color: "var(--color-accent)" }}>
          FEELDSCOPE
        </span>
      </div>

      {/* Airfield name */}
      <div
        className="flex items-center h-full shrink-0"
        style={{ paddingLeft: "1em", paddingRight: "1em", borderRight: "1px solid var(--color-border)" }}
      >
        <span className="text-sm" style={{ color: "var(--color-text-primary)" }}>
          {units.airfield.name}
        </span>
      </div>

      {/* Menu bar */}
      <nav className="flex h-full">
        <NavTab tabId="map" label="マップ" active={activeTab === "map"} onClick={setActiveTab} />
        <div style={{ width: 1, background: "var(--color-border)" }} />
        <NavTab tabId="status" label="ステータス" active={activeTab === "status"} onClick={setActiveTab} />
        <div style={{ width: 1, background: "var(--color-border)" }} />
        <NavTab tabId="settings" label="設定" active={activeTab === "settings"} onClick={setActiveTab} />
        <div style={{ width: 1, background: "var(--color-border)" }} />
        <NavTab tabId="ogn" label="OGN設定" active={activeTab === "ogn"} onClick={setActiveTab} />
        <div style={{ width: 1, background: "var(--color-border)" }} />
        <NavTab tabId="aircraft-db" label="機体情報" active={activeTab === "aircraft-db"} onClick={setActiveTab} />
        <div style={{ width: 1, background: "var(--color-border)" }} />
        <div className="h-full flex items-center">
          <HelpMenu onSelect={(tab) => openHelpTab(tab)} />
        </div>
      </nav>

      {/* Right: clock */}
      <div className="ml-auto flex items-center h-full" style={{ paddingLeft: "1em", paddingRight: "1em", borderLeft: "1px solid var(--color-border)" }}>
        <span
          className="text-base font-semibold tabular-nums"
          style={{ color: "var(--color-text-primary)", letterSpacing: "0.02em" }}
        >
          {clock}
        </span>
      </div>
    </header>
  );
}

/* ── Help dropdown ── */
function HelpMenu({ onSelect }: { onSelect: (tab: HelpTab) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  function select(tab: HelpTab) {
    setOpen(false);
    onSelect(tab);
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center h-full text-sm transition-colors"
        style={{
          paddingLeft: "1em",
          paddingRight: "1em",
          background: open ? "var(--color-bg-hover)" : "transparent",
          color: "var(--color-text-primary)",
        }}
      >
        ヘルプ
      </button>
      {open && (
        <div
          className="absolute top-full right-0 py-1 shadow-lg z-50 min-w-[180px]"
          style={{
            background: "var(--color-bg-secondary)",
            border: "1px solid var(--color-border-strong)",
            borderRadius: 4,
          }}
        >
          <DropdownItem label="マニュアル" onClick={() => select("manual")} />
          <DropdownItem label="リリースノート" onClick={() => select("release-notes")} />
          <DropdownItem label="バージョン" onClick={() => select("version")} />
          <div style={{ height: 1, background: "var(--color-border)", margin: "4px 0" }} />
          <DropdownItem label="サポート" onClick={() => select("support")} />
        </div>
      )}
    </div>
  );
}

function DropdownItem({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="block w-full text-left px-4 py-1.5 text-sm transition-colors"
      style={{ color: "var(--color-text-primary)" }}
      onMouseEnter={(e) => { (e.target as HTMLElement).style.background = "var(--color-accent)"; (e.target as HTMLElement).style.color = "#fff"; }}
      onMouseLeave={(e) => { (e.target as HTMLElement).style.background = "transparent"; (e.target as HTMLElement).style.color = "var(--color-text-primary)"; }}
    >
      {label}
    </button>
  );
}

function NavTab({ tabId, label, active, onClick }: { tabId: TabId; label: string; active: boolean; onClick: (tab: TabId) => void }) {
  return (
    <button
      onClick={() => onClick(tabId)}
      className="flex items-center h-full text-sm transition-colors"
      style={{
        paddingLeft: "1em",
        paddingRight: "1em",
        background: active ? "var(--color-accent-light)" : "transparent",
        color: active ? "var(--color-accent)" : "var(--color-text-primary)",
        borderBottom: active ? "2px solid var(--color-accent)" : "2px solid transparent",
        fontWeight: active ? 600 : 400,
      }}
    >
      {label}
    </button>
  );
}
