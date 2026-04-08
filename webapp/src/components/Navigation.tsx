"use client";

import React, { useState, useEffect, useRef } from "react";
import { useUnits } from "@/lib/UnitContext";
import { useTab, type TabId } from "@/lib/TabContext";

type HelpTab = "manual" | "release-notes" | "version";

export default function Navigation() {
  const { activeTab, setActiveTab } = useTab();
  const [clock, setClock] = useState("--:--:--");
  const { units } = useUnits();
  const [helpTab, setHelpTab] = useState<HelpTab | null>(null);

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
    <>
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
          <NavTab tabId="settings" label="設定" active={activeTab === "settings"} onClick={setActiveTab} />
          <div style={{ width: 1, background: "var(--color-border)" }} />
          <NavTab tabId="aircraft-db" label="機体情報" active={activeTab === "aircraft-db"} onClick={setActiveTab} />
          <div style={{ width: 1, background: "var(--color-border)" }} />
          <div className="h-full flex items-center">
            <HelpMenu onSelect={(tab) => setHelpTab(tab)} />
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

      {helpTab && <HelpModal tab={helpTab} onTabChange={setHelpTab} onClose={() => setHelpTab(null)} />}
    </>
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

/* ── Help modal popup ── */
const TABS: { key: HelpTab; label: string }[] = [
  { key: "manual", label: "マニュアル" },
  { key: "release-notes", label: "リリースノート" },
  { key: "version", label: "バージョン" },
];

function HelpModal({
  tab,
  onTabChange,
  onClose,
}: {
  tab: HelpTab;
  onTabChange: (t: HelpTab) => void;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.45)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="relative flex flex-col shadow-2xl"
        style={{
          background: "var(--color-bg-primary)",
          border: "1px solid var(--color-border-strong)",
          borderRadius: 6,
          width: "min(720px, 90vw)",
          maxHeight: "85vh",
        }}
      >
        {/* Title bar + Tab bar — single row */}
        <div
          className="flex items-center shrink-0"
          style={{
            height: 40,
            background: "var(--color-bg-secondary)",
            borderBottom: "1px solid var(--color-border)",
            borderRadius: "6px 6px 0 0",
          }}
        >
          <div
            className="flex items-center h-full shrink-0"
            style={{ paddingLeft: "1em", paddingRight: "1em", borderRight: "1px solid var(--color-border)" }}
          >
            <span className="text-sm font-semibold" style={{ color: "var(--color-text-primary)" }}>ヘルプ</span>
          </div>

          {TABS.map((t, i) => (
            <button
              key={t.key}
              onClick={() => onTabChange(t.key)}
              className="flex items-center h-full text-sm transition-colors"
              style={{
                paddingLeft: "1em",
                paddingRight: "1em",
                borderRight: "1px solid var(--color-border)",
                borderBottom: tab === t.key ? "2px solid var(--color-accent)" : "2px solid transparent",
                color: tab === t.key ? "var(--color-accent)" : "var(--color-text-primary)",
                fontWeight: tab === t.key ? 600 : 400,
                background: tab === t.key ? "var(--color-accent-light)" : "transparent",
              }}
            >
              {t.label}
            </button>
          ))}

          <div className="flex-1" />
          <button
            onClick={onClose}
            className="flex items-center justify-center h-full shrink-0 transition-colors"
            style={{ width: 46, color: "var(--color-text-secondary)", borderLeft: "1px solid var(--color-border)" }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "var(--color-danger)"; (e.currentTarget as HTMLElement).style.color = "#fff"; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; (e.currentTarget as HTMLElement).style.color = "var(--color-text-secondary)"; }}
          >
            ×
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5">
          <div className="max-w-2xl mx-auto space-y-4">
            {tab === "manual" && <ManualContent />}
            {tab === "release-notes" && <ReleaseNotesContent />}
            {tab === "version" && <VersionContent />}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Tab contents ── */

function ManualContent() {
  return (
    <>
      <Card title="FEELDSCOPE マニュアル">
        <p className="text-sm leading-relaxed" style={{ color: "var(--color-text-secondary)" }}>
          FEELDSCOPE は、OGN（Open Glider Network）の FLARM データおよび ADS-B データをリアルタイムに受信・表示するフライトモニターです。
          Raspberry Pi 上で動作し、滑空場周辺のグライダー、モーターグライダー、曳航機、および周辺航空機の位置を地図上に表示します。
        </p>
      </Card>

      <Card title="画面構成">
        <div className="space-y-4 text-sm" style={{ color: "var(--color-text-secondary)" }}>
          <Section heading="ナビゲーションバー（共通）">
            <ul className="list-disc ml-5 space-y-1">
              <li><strong>FEELDSCOPE</strong> — アプリケーション名</li>
              <li><strong>滑空場名</strong> — 設定画面で設定した滑空場名を表示</li>
              <li><strong>マップ</strong> — マップ画面に切替</li>
              <li><strong>設定</strong> — 設定画面に切替</li>
              <li><strong>機体情報</strong> — 機体情報データベース画面に切替</li>
              <li><strong>ヘルプ</strong> — マニュアル / リリースノート / バージョン情報をポップアップ表示</li>
              <li><strong>時計</strong> — 現在時刻をリアルタイム表示（右端）</li>
            </ul>
          </Section>
          <Section heading="マップ画面">
            <ul className="list-disc ml-5 space-y-1">
              <li>マップ上に FLARM 機体と ADS-B 機体がリアルタイムで表示されます</li>
              <li>FLARM 機体アイコンの色で状態を識別できます（緑: 通常、橙: 低高度/着陸進入中、赤: パス不足）</li>
              <li>着陸進入中の機体はオレンジ色で表示され、着陸確定後に緑に戻ります</li>
              <li>ADS-B 機体は青（ADS-B）または黒（Mode-S/C）で表示されます</li>
              <li>機体をクリックすると詳細情報（高度、速度、上昇率、方位、パス L/D）が表示されます</li>
              <li>赤く点滅する機体はパス不足（滑空場に安全に帰還できない高度）を示しています</li>
              <li>サイドバーに警告・上空・ADS-B・地上の4カテゴリで機体一覧が表示されます</li>
              <li>サイドバーの幅はドラッグで変更可能（ブラウザに保存）</li>
              <li>フライトログテーブルに離陸・着陸時刻、飛行時間（飛行中はリアルタイム更新）、離脱高度が自動記録されます</li>
              <li>フライトログテーブルの高さはドラッグで変更可能（ブラウザに保存）</li>
              <li>マップの初期表示位置はホームビュー設定で保存可能（ブラウザに保存）</li>
            </ul>
          </Section>
          <Section heading="設定画面">
            <p className="mb-2">各設定項目の詳細は下記「設定項目リファレンス」を参照してください。</p>
            <ul className="list-disc ml-5 space-y-1">
              <li><strong>滑空場設定</strong> — 名前・緯度・経度・標高</li>
              <li><strong>データソース切替</strong> — リアルタイム / 履歴再生 / 停止</li>
              <li><strong>システムステータス</strong> — 各サービスの稼働状態（読み取り専用）</li>
              <li><strong>表示設定</strong> — ラベル表示名・単位・安全滑空比</li>
              <li><strong>ADS-B 受信設定</strong> — URL・間隔・有効/無効</li>
              <li><strong>システム電源</strong> — 再起動・シャットダウン</li>
              <li><strong>システム固定化</strong> — オーバーレイFS の ON/OFF</li>
              <li><strong>IGC ファイル管理</strong> — アップロード・削除</li>
            </ul>
          </Section>
          <Section heading="機体情報画面">
            <ul className="list-disc ml-5 space-y-1">
              <li>FLARM デバイス ID ごとに機体情報（機種名、登録番号、コンテスト番号、パイロット名、航空機タイプ）を管理</li>
              <li>新規追加・編集・削除が可能</li>
              <li>未登録の FLARM 機体がマップに出現すると自動的にデバイス ID が登録されます</li>
              <li>固定化中はデータベースへの変更は再起動時にリセットされます（警告バッジ表示）</li>
            </ul>
          </Section>
        </div>
      </Card>

      <Card title="設定項目リファレンス">
        <div className="space-y-4 text-sm" style={{ color: "var(--color-text-secondary)" }}>
          <div className="rounded overflow-hidden" style={{ border: "1px solid var(--color-border)" }}>
            <table className="w-full text-sm">
              <thead>
                <tr style={{ background: "var(--color-bg-primary)" }}>
                  <th className="text-left px-3 py-2 font-semibold text-xs" style={{ color: "var(--color-text-secondary)", borderBottom: "1px solid var(--color-border)" }}>設定項目</th>
                  <th className="text-left px-3 py-2 font-semibold text-xs" style={{ color: "var(--color-text-secondary)", borderBottom: "1px solid var(--color-border)" }}>保存先</th>
                  <th className="text-left px-3 py-2 font-semibold text-xs" style={{ color: "var(--color-text-secondary)", borderBottom: "1px solid var(--color-border)" }}>操作</th>
                </tr>
              </thead>
              <tbody>
                {[
                  { item: "滑空場名", storage: "ブラウザ", ops: "テキスト入力" },
                  { item: "滑空場 緯度・経度・標高", storage: "ブラウザ", ops: "数値入力" },
                  { item: "データソース切替", storage: "サーバー（systemd）", ops: "リアルタイム / 履歴再生 / 停止ボタン" },
                  { item: "再生倍速（1〜20x）", storage: "ブラウザ", ops: "スライダー" },
                  { item: "システムステータス", storage: "—", ops: "読み取り専用（5秒間隔で自動更新）" },
                  { item: "機体ラベル表示名", storage: "ブラウザ", ops: "CN / 登録番号 / パイロット名 切替" },
                  { item: "高度の単位", storage: "ブラウザ", ops: "m / ft 切替" },
                  { item: "速度の単位", storage: "ブラウザ", ops: "km/h / knot 切替" },
                  { item: "上昇率の単位", storage: "ブラウザ", ops: "m/s / knot/s 切替" },
                  { item: "安全滑空比", storage: "ブラウザ", ops: "数値入力（1〜100、デフォルト: 15）" },
                  { item: "ADS-B 有効/無効", storage: "ブラウザ + サーバー", ops: "チェックボックス" },
                  { item: "ADS-B URL", storage: "ブラウザ + サーバー", ops: "テキスト入力" },
                  { item: "ADS-B ポーリング間隔", storage: "ブラウザ + サーバー", ops: "数値入力（1〜30秒）" },
                  { item: "システム再起動", storage: "—", ops: "ボタン（確認ダイアログあり）" },
                  { item: "システムシャットダウン", storage: "—", ops: "ボタン（確認ダイアログあり）" },
                  { item: "システム固定化 ON/OFF", storage: "サーバー（raspi-config）", ops: "ON / OFF ボタン（再起動で反映）" },
                  { item: "IGC ファイル管理", storage: "サーバー（ファイル）", ops: "アップロード / 削除" },
                ].map(({ item, storage, ops }, i) => (
                  <tr key={i} style={{ borderBottom: "1px solid var(--color-border)" }}>
                    <td className="px-3 py-1.5"><strong>{item}</strong></td>
                    <td className="px-3 py-1.5">{storage}</td>
                    <td className="px-3 py-1.5">{ops}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <Section heading="マップ画面の保存項目（ブラウザ保存）">
            <ul className="list-disc ml-5 space-y-1">
              <li><strong>サイドバー幅</strong> — ドラッグで変更した幅を自動保存</li>
              <li><strong>フライトログ高さ</strong> — ドラッグで変更した高さを自動保存</li>
              <li><strong>ホームビュー</strong> — マップの初期表示位置・ズームレベルを保存</li>
              <li><strong>フライトログデータ</strong> — 離陸・着陸時刻、離脱高度などのフライト記録を自動保存</li>
            </ul>
          </Section>

          <Section heading="機体情報画面の保存項目">
            <ul className="list-disc ml-5 space-y-1">
              <li><strong>機体情報データベース</strong> — サーバー（aircraft-db.json）に保存</li>
            </ul>
          </Section>
        </div>
      </Card>

      <Card title="システム固定化（オーバーレイFS）">
        <div className="text-sm space-y-2" style={{ color: "var(--color-text-secondary)" }}>
          <Section heading="概要">
            <p>システム固定化は Raspberry Pi のオーバーレイファイルシステム（OverlayFS）を利用した機能です。有効にすると SD カードが読み取り専用になり、稼働中のファイル変更はメモリ上にのみ保持され、再起動時に固定化した時点の状態に自動復帰します。</p>
          </Section>
          <Section heading="突然の電源 OFF への保護">
            <p>安定稼働を確認したら固定化を有効にすることを推奨します。固定化により SD カードへの書き込みが発生しないため、突然の電源断（停電、コンセント抜け等）でも SD カードのファイルシステム破損を防止でき、システムを安全に保護できます。通常運用では固定化 ON の状態で使用してください。</p>
          </Section>
          <Section heading="固定化の ON/OFF 手順">
            <ul className="list-disc ml-5 space-y-1">
              <li><strong>ON にする:</strong> 設定画面「システム固定化」で ON を押し、システムを再起動すると有効になります</li>
              <li><strong>OFF にする:</strong> 設定画面「システム固定化」で OFF を押し、システムを再起動すると解除されます</li>
              <li>ON/OFF の切替は再起動後に反映されます</li>
            </ul>
          </Section>
          <Section heading="固定化時の設定の保持・リセット">
            <div className="mt-2 rounded overflow-hidden" style={{ border: "1px solid var(--color-border)" }}>
              <table className="w-full text-sm">
                <thead>
                  <tr style={{ background: "var(--color-bg-primary)" }}>
                    <th className="text-left px-3 py-2 font-semibold text-xs" style={{ color: "var(--color-text-secondary)", borderBottom: "1px solid var(--color-border)" }}>設定項目</th>
                    <th className="text-center px-3 py-2 font-semibold text-xs" style={{ color: "var(--color-text-secondary)", borderBottom: "1px solid var(--color-border)" }}>再起動後</th>
                    <th className="text-left px-3 py-2 font-semibold text-xs" style={{ color: "var(--color-text-secondary)", borderBottom: "1px solid var(--color-border)" }}>理由</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    { item: "滑空場設定（名前・位置・標高）", survive: "残る", reason: "ブラウザ localStorage に保存" },
                    { item: "表示設定（単位・ラベル・滑空比）", survive: "残る", reason: "ブラウザ localStorage に保存" },
                    { item: "ADS-B 受信設定", survive: "残る", reason: "ブラウザ localStorage + サーバー側ファイルだが、ブラウザ設定から自動復元" },
                    { item: "再生倍速", survive: "残る", reason: "ブラウザ localStorage に保存" },
                    { item: "サイドバー幅・ログ高さ・ホームビュー", survive: "残る", reason: "ブラウザ localStorage に保存" },
                    { item: "フライトログデータ", survive: "残る", reason: "ブラウザ localStorage に保存" },
                    { item: "機体情報データベース", survive: "リセット", reason: "サーバー側ファイル（aircraft-db.json）" },
                    { item: "IGC ファイル", survive: "リセット", reason: "サーバー側ファイル" },
                    { item: "ADS-B 設定ファイル", survive: "リセット", reason: "サーバー側ファイル（adsb-config.json）だが、ブラウザ設定から自動復元されるため実質影響なし" },
                  ].map(({ item, survive, reason }, i) => (
                    <tr key={i} style={{ borderBottom: "1px solid var(--color-border)" }}>
                      <td className="px-3 py-1.5"><strong>{item}</strong></td>
                      <td className="px-3 py-1.5 text-center">
                        <span className="px-2 py-0.5 rounded text-xs font-medium" style={{
                          background: survive === "残る" ? "var(--color-success-dim)" : "var(--color-warning-dim)",
                          color: survive === "残る" ? "var(--color-success)" : "var(--color-warning)",
                        }}>{survive}</span>
                      </td>
                      <td className="px-3 py-1.5 text-xs">{reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>
          <Section heading="固定化の解除と設定の引き継ぎ">
            <ul className="list-disc ml-5 space-y-1">
              <li>固定化を OFF にして再起動すると、通常モードに戻ります</li>
              <li>ブラウザに保存されている設定（滑空場・表示設定・ADS-B 等）は固定化の ON/OFF に関わらず常に引き継がれます</li>
              <li>サーバー側ファイル（機体情報 DB・IGC ファイル）は固定化を ON にした時点の内容に戻ります</li>
              <li>固定化中に追加した機体情報や IGC ファイルは、固定化解除の再起動でも失われます。変更を永続化したい場合は先に固定化を OFF にして再起動し、通常モードで変更してください</li>
              <li>別のブラウザや端末からアクセスした場合、ブラウザ側の設定はそのブラウザにのみ保存されているため、各端末で個別に設定が必要です</li>
            </ul>
          </Section>
        </div>
      </Card>

      <Card title="航空機タイプとアイコン">
        <div className="text-sm" style={{ color: "var(--color-text-secondary)" }}>
          <p className="mb-3">機体情報データベースで設定した航空機タイプに応じて、マップ上のアイコンが変わります。</p>
          <div className="grid gap-2" style={{ gridTemplateColumns: "40px 1fr" }}>
            {[
              { svg: `<svg width="30" height="30" viewBox="-15 -15 30 30"><path d="M0,-11 L.8,-3 L14,-0.5 L14,0.5 L.8,1.5 L.4,8 L2.5,9.5 L2.5,10.5 L-2.5,10.5 L-2.5,9.5 L-.4,8 L-.8,1.5 L-14,0.5 L-14,-0.5 L-.8,-3Z" fill="#4caf50" stroke="rgba(0,0,0,.4)" stroke-width=".5"/></svg>`, label: "グライダー/モーターグライダー", desc: "離着陸時間と離脱高度の自動検知対象" },
              { svg: `<svg width="30" height="30" viewBox="-15 -15 30 30"><path d="M0,-12 L1.5,-4 L1.5,-2 L10,-2 L10,1 L1.5,1 L1,9 L4,10 L4,11.5 L-4,11.5 L-4,10 L-1,9 L-1.5,1 L-10,1 L-10,-2 L-1.5,-2 L-1.5,-4Z" fill="#4caf50" stroke="rgba(0,0,0,.4)" stroke-width=".5"/></svg>`, label: "曳航機", desc: "離着陸時間と離脱高度の自動検知対象" },
              { svg: `<svg width="30" height="30" viewBox="-15 -15 30 30"><path d="M0,-11 L1.5,-4 L9,-1 L9,1 L1.5,2 L1,9 L3.5,10 L3.5,11 L-3.5,11 L-3.5,10 L-1,9 L-1.5,2 L-9,1 L-9,-1 L-1.5,-4Z" fill="#4caf50" stroke="rgba(0,0,0,.4)" stroke-width=".5"/><line x1="-3" y1="-12" x2="3" y2="-12" stroke="#4caf50" stroke-width="1.5" stroke-linecap="round"/></svg>`, label: "動力機" },
              { svg: `<svg width="30" height="30" viewBox="-15 -15 30 30"><line x1="-12" y1="-10" x2="12" y2="-10" stroke="#4caf50" stroke-width="2" stroke-linecap="round"/><line x1="0" y1="-10" x2="0" y2="-6" stroke="#4caf50" stroke-width="1.2"/><circle cx="0" cy="-1" r="5.5" fill="#4caf50" stroke="rgba(0,0,0,.4)" stroke-width=".5"/><line x1="-4" y1="4.5" x2="-6" y2="10" stroke="#4caf50" stroke-width="1.5" stroke-linecap="round"/><line x1="4" y1="4.5" x2="6" y2="10" stroke="#4caf50" stroke-width="1.5" stroke-linecap="round"/><line x1="-7" y1="10" x2="-5" y2="10" stroke="#4caf50" stroke-width="1.5" stroke-linecap="round"/><line x1="5" y1="10" x2="7" y2="10" stroke="#4caf50" stroke-width="1.5" stroke-linecap="round"/></svg>`, label: "ヘリコプター" },
              { svg: `<svg width="30" height="30" viewBox="-15 -15 30 30"><path d="M-10,-3 Q-5,-10 0,-10 Q5,-10 10,-3 L10,-1 Q5,-6 0,-6 Q-5,-6 -10,-1Z" fill="#4caf50" stroke="rgba(0,0,0,.4)" stroke-width=".5"/><line x1="-7" y1="-2" x2="0" y2="6" stroke="#4caf50" stroke-width=".7"/><line x1="7" y1="-2" x2="0" y2="6" stroke="#4caf50" stroke-width=".7"/><line x1="-3" y1="-3" x2="0" y2="6" stroke="#4caf50" stroke-width=".5" opacity=".5"/><line x1="3" y1="-3" x2="0" y2="6" stroke="#4caf50" stroke-width=".5" opacity=".5"/><circle cx="0" cy="7" r="2" fill="#4caf50" stroke="rgba(0,0,0,.4)" stroke-width=".3"/></svg>`, label: "パラグライダー" },
              { svg: `<svg width="30" height="30" viewBox="-15 -15 30 30"><path d="M0,-8 L12,6 Q0,2 -12,6Z" fill="#4caf50" stroke="rgba(0,0,0,.4)" stroke-width=".5" fill-opacity=".8"/><circle cx="0" cy="3" r="1.5" fill="#4caf50" stroke="rgba(0,0,0,.4)" stroke-width=".3"/></svg>`, label: "ハンググライダー" },
              { svg: `<svg width="30" height="30" viewBox="-15 -15 30 30"><circle cx="0" cy="-6" r="3" fill="#4caf50" stroke="rgba(0,0,0,.4)" stroke-width=".5"/><line x1="0" y1="-3" x2="0" y2="5" stroke="#4caf50" stroke-width="2" stroke-linecap="round"/><line x1="-7" y1="-1" x2="7" y2="-1" stroke="#4caf50" stroke-width="1.5" stroke-linecap="round"/><line x1="0" y1="5" x2="-5" y2="11" stroke="#4caf50" stroke-width="1.5" stroke-linecap="round"/><line x1="0" y1="5" x2="5" y2="11" stroke="#4caf50" stroke-width="1.5" stroke-linecap="round"/></svg>`, label: "スカイダイバー" },
              { svg: `<svg width="30" height="30" viewBox="-15 -15 30 30"><ellipse cx="0" cy="-3" rx="8" ry="10" fill="#4caf50" stroke="rgba(0,0,0,.4)" stroke-width=".5"/><line x1="-3" y1="7" x2="-2" y2="10" stroke="#4caf50" stroke-width=".7"/><line x1="3" y1="7" x2="2" y2="10" stroke="#4caf50" stroke-width=".7"/><rect x="-3" y="10" width="6" height="4" rx="1" fill="#4caf50" stroke="rgba(0,0,0,.4)" stroke-width=".4"/></svg>`, label: "バルーン" },
              { svg: `<svg width="30" height="30" viewBox="-15 -15 30 30"><rect x="-3" y="-3" width="6" height="6" rx="1" fill="#4caf50" stroke="rgba(0,0,0,.4)" stroke-width=".5"/><line x1="-3" y1="-3" x2="-9" y2="-9" stroke="#4caf50" stroke-width="1.5"/><line x1="3" y1="-3" x2="9" y2="-9" stroke="#4caf50" stroke-width="1.5"/><line x1="-3" y1="3" x2="-9" y2="9" stroke="#4caf50" stroke-width="1.5"/><line x1="3" y1="3" x2="9" y2="9" stroke="#4caf50" stroke-width="1.5"/><circle cx="-9" cy="-9" r="3" fill="none" stroke="#4caf50" stroke-width=".8"/><circle cx="9" cy="-9" r="3" fill="none" stroke="#4caf50" stroke-width=".8"/><circle cx="-9" cy="9" r="3" fill="none" stroke="#4caf50" stroke-width=".8"/><circle cx="9" cy="9" r="3" fill="none" stroke="#4caf50" stroke-width=".8"/></svg>`, label: "UAV" },
              { svg: `<svg width="24" height="24" viewBox="-12 -12 24 24"><path d="M0,-10 L1.5,-4 L8,-1 L8,0.5 L1.5,1.5 L1,6 L3.5,7.5 L3.5,8.5 L-3.5,8.5 L-3.5,7.5 L-1,6 L-1.5,1.5 L-8,0.5 L-8,-1 L-1.5,-4Z" fill="#1565c0" stroke="rgba(255,255,255,.5)" stroke-width=".5"/></svg>`, label: "ジェット機" },
            ].map(({ svg, label, desc }, i) => (
              <React.Fragment key={i}>
                <div className="flex items-center justify-center" dangerouslySetInnerHTML={{ __html: svg }} />
                <div><strong>{label}</strong>{desc ? ` — ${desc}` : ""}</div>
              </React.Fragment>
            ))}
          </div>
        </div>
      </Card>

      <Card title="データソース">
        <div className="space-y-4 text-sm" style={{ color: "var(--color-text-secondary)" }}>
          <Section heading="リアルタイム受信（FLARM）">
            <p>OGN レシーバー（RTL-SDR + ogn-rf/ogn-decode）が 922.4 MHz で受信した FLARM データを、ogn-mqtt.py が MQTT 経由でリアルタイムに配信します。</p>
          </Section>
          <Section heading="ADS-B 受信">
            <p>同一ネットワーク上の tar1090/dump1090 フィーダーから aircraft.json を定期取得し、ADS-B / Mode-S / Mode-C 機体をマップに表示します。FLARM と同時に受信可能です。位置情報を持たない Mode-S/C 機体もサイドバーに高度付きで一覧表示されます。</p>
          </Section>
          <Section heading="履歴再生（IGC）">
            <p>IGC フライトログファイルを使って過去のフライトを再生します。OLC（onlinecontest.org）などから IGC ファイルをダウンロードし、設定画面からアップロードしてください。再生速度は 1〜20 倍速で調整可能で、ループ再生に対応しています。</p>
          </Section>
        </div>
      </Card>

      <Card title="フライトログ・自動検知">
        <div className="text-sm space-y-2" style={{ color: "var(--color-text-secondary)" }}>
          <p><strong>離陸検知:</strong> 対地速度が 30 km/h を超えた時点で離陸を自動記録します。</p>
          <p><strong>着陸検知:</strong> 一度 1500ft AGL を超えた機体が、1500ft AGL 以下かつ 10 km/h 以下になった時点で着陸を記録します。</p>
          <p><strong>離脱検知:</strong> グライダーが旋回率 8°/s 以上 + 速度低下 10 km/h 以上 + 高度 500ft AGL 以上の条件で曳航離脱を検知し、離脱高度を記録します。</p>
          <p><strong>飛行時間:</strong> 飛行中はリアルタイムで経過時間を表示し、着陸後は確定した飛行時間を表示します。</p>
          <p>フライトログの離陸・着陸時刻および離脱高度は手動で編集可能です。</p>
        </div>
      </Card>

      <Card title="パス判定（安全滑空比）">
        <div className="text-sm space-y-2" style={{ color: "var(--color-text-secondary)" }}>
          <p>各機体について、滑空場までの距離と現在の高度から滑空比を計算します。設定した安全滑空比（デフォルト: 15:1）を超えた場合、パス不足として赤く点滅して警告します。</p>
          <p><strong>計算式:</strong> 必要滑空比 = 滑空場までの距離 ÷ (現在高度 - 滑空場標高)</p>
          <p>安全滑空比は設定画面の「表示設定」から変更できます。</p>
        </div>
      </Card>

      <Card title="システム構成">
        <div className="text-sm" style={{ color: "var(--color-text-secondary)" }}>
          <ul className="list-disc ml-5 space-y-1">
            <li><strong>Raspberry Pi 5</strong> — ハードウェアプラットフォーム</li>
            <li><strong>RTL-SDR</strong> — 922.4 MHz（日本向け）FLARM 信号受信</li>
            <li><strong>rtlsdr-ogn (ogn-rf + ogn-decode)</strong> — OGN 受信・デコードデーモン</li>
            <li><strong>ogn-mqtt.py</strong> — OGN APRS → MQTT 変換パブリッシャー</li>
            <li><strong>adsb-poller.py</strong> — tar1090/dump1090 ADS-B データ取得・MQTT 配信</li>
            <li><strong>Mosquitto</strong> — MQTT ブローカー（WebSocket 対応）</li>
            <li><strong>Next.js 16 Web アプリ</strong> — フロントエンド（本画面）</li>
            <li><strong>igc-simulator.py</strong> — IGC ファイル履歴再生エンジン</li>
          </ul>
        </div>
      </Card>
    </>
  );
}

function ReleaseNotesContent() {
  return (
    <>
      {/* v1.0.0 */}
      <div className="flex items-center gap-3 mb-2">
        <span className="text-base font-bold" style={{ color: "var(--color-accent)" }}>v1.0.0</span>
        <span className="text-sm" style={{ color: "var(--color-text-secondary)" }}>2026-03-20</span>
        <span className="px-2 py-0.5 rounded text-xs font-medium" style={{ background: "var(--color-accent-light)", color: "var(--color-accent)" }}>初版リリース</span>
      </div>

      <Card title="FLARM 受信・表示">
        <ul className="list-disc ml-5 space-y-1 text-sm" style={{ color: "var(--color-text-secondary)" }}>
          <li>OGN FLARM データのリアルタイム受信・マップ表示</li>
          <li>機体状態の色分け表示（緑: 通常、橙: 低高度/着陸進入中、赤: パス不足）</li>
          <li>着陸進入中はオレンジ表示、着陸確定後に緑に復帰</li>
          <li>パス判定（安全滑空比による帰還可否の警告・赤点滅）</li>
          <li>機体種別アイコン（グライダー / 曳航機）</li>
        </ul>
      </Card>

      <Card title="ADS-B 受信">
        <ul className="list-disc ml-5 space-y-1 text-sm" style={{ color: "var(--color-text-secondary)" }}>
          <li>ADS-B / Mode-S / Mode-C 受信機能（tar1090/dump1090 連携）</li>
          <li>ADS-B 機体のマップ表示（青: ADS-B、黒: Mode-S/C）</li>
          <li>位置不明機体のサイドバー表示（Mode-S/C 高度のみ）</li>
          <li>ADS-B 受信設定 UI（URL・ポーリング間隔・有効/無効切替）</li>
        </ul>
      </Card>

      <Card title="フライトログ">
        <ul className="list-disc ml-5 space-y-1 text-sm" style={{ color: "var(--color-text-secondary)" }}>
          <li>離陸・着陸・曳航離脱の自動検知・記録</li>
          <li>飛行中の飛行時間リアルタイム表示</li>
          <li>離陸・着陸時刻、離脱高度の手動編集</li>
          <li>IGC ファイルによる履歴再生（1〜20 倍速ループ）</li>
        </ul>
      </Card>

      <Card title="GUI・設定">
        <ul className="list-disc ml-5 space-y-1 text-sm" style={{ color: "var(--color-text-secondary)" }}>
          <li>Windows 標準 GUI 準拠のインターフェース</li>
          <li>マップ / サイドバー / フライトログのリサイズ対応</li>
          <li>表示単位の切替（高度: m/ft、速度: km/h/knot、上昇率: m/s/knot/s）</li>
          <li>機体ラベル表示名の選択（コンテスト番号 / 登録番号 / パイロット名）</li>
          <li>滑空場設定（名前・位置・標高）</li>
          <li>ヘルプメニュー（マニュアル・リリースノート・バージョン）ポップアップ表示</li>
        </ul>
      </Card>

      <Card title="システム基盤">
        <ul className="list-disc ml-5 space-y-1 text-sm" style={{ color: "var(--color-text-secondary)" }}>
          <li>Raspberry Pi 5 + RTL-SDR 対応（922.4 MHz 日本向けバイナリパッチ）</li>
          <li>Next.js 16 + React 19 による Web フロントエンド</li>
          <li>Mosquitto MQTT ブローカー統合（WebSocket 対応）</li>
          <li>ogn-mqtt.py / igc-simulator.py / adsb-poller.py によるバックエンド</li>
          <li>全サービスの systemd 統合</li>
        </ul>
      </Card>
    </>
  );
}

function VersionContent() {
  return (
    <>
      <Card title="バージョン情報">
        <div className="space-y-4">
          <div className="flex items-center gap-4">
            <span className="text-2xl font-bold tracking-widest" style={{ color: "var(--color-accent)" }}>FEELDSCOPE</span>
          </div>
          <p className="text-sm" style={{ color: "var(--color-text-secondary)" }}>OGN FLARM リアルタイムフライトモニター</p>
          <InfoRow label="バージョン" value="1.0.0" />
          <InfoRow label="リリース日" value="2026-03-20" />
          <InfoRow label="著作権" value="Hiroshi Ezoe" />
        </div>
      </Card>

      <Card title="コンポーネント">
        <div className="space-y-2">
          <InfoRow label="Next.js" value="16.1.6" />
          <InfoRow label="React" value="19.2.3" />
          <InfoRow label="Leaflet" value="1.9.4" />
          <InfoRow label="MQTT.js" value="5.15.0" />
          <InfoRow label="rtlsdr-ogn" value="0.3.3" />
        </div>
      </Card>

      <Card title="動作環境">
        <div className="space-y-2">
          <InfoRow label="プラットフォーム" value="Raspberry Pi 5" />
          <InfoRow label="OS" value="Raspberry Pi OS (Linux)" />
          <InfoRow label="受信周波数" value="922.4 MHz（日本）" />
          <InfoRow label="受信機" value="RTL-SDR" />
        </div>
      </Card>

      <Card title="ライセンス・クレジット">
        <div className="text-sm space-y-2" style={{ color: "var(--color-text-secondary)" }}>
          <p>Copyright (c) 2026 Hiroshi Ezoe. All rights reserved.</p>
          <p>本ソフトウェアは OGN（Open Glider Network）のデータを利用しています。</p>
          <p>地図データ: OpenStreetMap contributors</p>
        </div>
      </Card>
    </>
  );
}

/* ── Shared sub-components ── */

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section
      className="p-4"
      style={{
        background: "var(--color-bg-secondary)",
        border: "1px solid var(--color-border)",
        borderRadius: 4,
      }}
    >
      <h3 className="text-sm font-semibold mb-3 pb-2" style={{ color: "var(--color-text-primary)", borderBottom: "1px solid var(--color-border)" }}>{title}</h3>
      {children}
    </section>
  );
}

function Section({ heading, children }: { heading: string; children: React.ReactNode }) {
  return (
    <div>
      <h4 className="font-semibold mb-1" style={{ color: "var(--color-text-primary)" }}>{heading}</h4>
      {children}
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-1.5 px-3 rounded text-sm" style={{ background: "var(--color-bg-card)" }}>
      <span style={{ color: "var(--color-text-secondary)" }}>{label}</span>
      <span className="font-semibold" style={{ color: "var(--color-text-primary)" }}>{value}</span>
    </div>
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
