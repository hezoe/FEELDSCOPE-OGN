"use client";

import React from "react";

const HELP_WINDOW_NAME = "feeldscope-help";
const HELP_WINDOW_FEATURES = "width=900,height=800,resizable=yes,scrollbars=yes";

export type HelpTab = "manual" | "release-notes" | "version" | "support";

function openHelpUrl(url: string) {
  const w = window.open(url, HELP_WINDOW_NAME, HELP_WINDOW_FEATURES);
  if (w) w.focus();
}

export function openHelpSection(sectionId: string) {
  const params = new URLSearchParams({ tab: "manual", section: sectionId });
  openHelpUrl(`/help?${params.toString()}`);
}

export function openHelpTab(tab: HelpTab) {
  openHelpUrl(`/help?tab=${tab}`);
}

export default function HelpHint({
  sectionId,
  title = "マニュアルを開く",
  className,
  size = 14,
}: {
  sectionId: string;
  title?: string;
  className?: string;
  size?: number;
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        e.preventDefault();
        openHelpSection(sectionId);
      }}
      title={title}
      aria-label={title}
      className={className}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: size + 4,
        height: size + 4,
        padding: 0,
        marginLeft: 6,
        borderRadius: "50%",
        background: "var(--color-bg-card)",
        color: "var(--color-text-secondary)",
        border: "1px solid var(--color-border)",
        fontSize: Math.round(size * 0.78),
        fontWeight: 700,
        lineHeight: 1,
        cursor: "pointer",
        verticalAlign: "middle",
        transition: "background-color .12s, color .12s, border-color .12s",
      }}
      onMouseEnter={(e) => {
        const el = e.currentTarget;
        el.style.background = "var(--color-accent)";
        el.style.color = "#fff";
        el.style.borderColor = "var(--color-accent)";
      }}
      onMouseLeave={(e) => {
        const el = e.currentTarget;
        el.style.background = "var(--color-bg-card)";
        el.style.color = "var(--color-text-secondary)";
        el.style.borderColor = "var(--color-border)";
      }}
    >
      ?
    </button>
  );
}
