"use client";

import { useEffect, useRef } from "react";
import { useTab } from "@/lib/TabContext";

/**
 * 開きっぱなしの画面を、端末の更新後に新しい版へ自動で切り替える。
 *
 * 端末を更新(git pull → build → 再起動)しても、開いたままのブラウザは古いJSのまま
 * MQTT で動き続ける(たきかわ 2026-09-28: v1.4.14 の地上くるくる対策が効かず、
 * 再読み込みで直った)。そこで自分のビルド版数と /api/version を定期的に比べ、
 * 違っていれば再読み込みする。
 *  - 地図タブを表示中で、入力欄にフォーカスが無いときだけ(設定の入力途中を消さない)。
 *    他のタブにいる間に見つけたら、地図タブへ戻ったときに行う
 *  - 同じ版への再読み込みは2分に1回まで(更新中のビルド不整合などで繰り返さない)
 */
const CHECK_INTERVAL_MS = 60_000;
const RELOAD_GUARD_MS = 2 * 60_000;
const RELOAD_GUARD_KEY = "feeldscope-reload-for";
const BUILD_VERSION = process.env.FEELDSCOPE_BUILD_VERSION || "";

export default function VersionWatcher() {
  const { activeTab } = useTab();
  const activeTabRef = useRef(activeTab);
  const pendingRef = useRef<string | null>(null); // 検知済みで再読み込み待ちの版数

  // refs だけを見るので、どの effect から呼んでも同じ判定になる
  const tryReloadRef = useRef(() => {
    const target = pendingRef.current;
    if (!target || document.hidden || activeTabRef.current !== "map") return;
    const el = document.activeElement;
    if (el && ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName)) return;
    try {
      const last = JSON.parse(sessionStorage.getItem(RELOAD_GUARD_KEY) || "null");
      if (last && last.version === target && Date.now() - last.at < RELOAD_GUARD_MS) return;
      sessionStorage.setItem(RELOAD_GUARD_KEY, JSON.stringify({ version: target, at: Date.now() }));
    } catch { /* sessionStorage が使えなくても再読み込みはする */ }
    console.log(`[version] ${BUILD_VERSION} -> ${target}: reloading`);
    window.location.reload();
  });

  useEffect(() => {
    activeTabRef.current = activeTab;
    if (activeTab !== "map" || !pendingRef.current) return;
    // 地図タブへ戻った: 描画が落ち着いてから待っていた再読み込みを行う
    const t = setTimeout(() => tryReloadRef.current(), 1000);
    return () => clearTimeout(t);
  }, [activeTab]);

  useEffect(() => {
    if (!BUILD_VERSION) return;
    let stopped = false;

    const check = async () => {
      if (stopped || document.hidden) return;
      try {
        const res = await fetch("/api/version", { cache: "no-store" });
        if (!res.ok) return;
        const { version } = (await res.json()) as { version: string | null };
        pendingRef.current = version && version !== BUILD_VERSION ? version : null;
      } catch { return; } // 端末の再起動中など。次の周期で見る
      if (!stopped) tryReloadRef.current();
    };

    check();
    const iv = setInterval(check, CHECK_INTERVAL_MS);
    const onVis = () => { if (!document.hidden) check(); };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("online", check);
    return () => {
      stopped = true;
      clearInterval(iv);
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("online", check);
    };
  }, []);

  return null;
}
