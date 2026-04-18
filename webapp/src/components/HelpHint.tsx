"use client";

import React from "react";

export const HELP_OPEN_EVENT = "feeldscope:open-help";

export function openHelp(sectionId: string) {
  window.dispatchEvent(new CustomEvent(HELP_OPEN_EVENT, { detail: sectionId }));
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
        openHelp(sectionId);
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
