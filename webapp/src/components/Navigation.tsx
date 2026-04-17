"use client";

import React, { useState, useEffect, useRef } from "react";
import { useUnits } from "@/lib/UnitContext";
import { useTab, type TabId } from "@/lib/TabContext";

type HelpTab = "manual" | "release-notes" | "version" | "support";

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
          <NavTab tabId="status" label="ステータス" active={activeTab === "status"} onClick={setActiveTab} />
          <div style={{ width: 1, background: "var(--color-border)" }} />
          <NavTab tabId="settings" label="設定" active={activeTab === "settings"} onClick={setActiveTab} />
          <div style={{ width: 1, background: "var(--color-border)" }} />
          <NavTab tabId="ogn" label="OGN設定" active={activeTab === "ogn"} onClick={setActiveTab} />
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

/* ── Help modal popup ── */
const TABS: { key: HelpTab; label: string }[] = [
  { key: "manual", label: "マニュアル" },
  { key: "release-notes", label: "リリースノート" },
  { key: "version", label: "バージョン" },
  { key: "support", label: "サポート" },
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
            {tab === "support" && <SupportContent />}
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
      <Card title="FEELDSCOPE とは">
        <p className="text-sm leading-relaxed" style={{ color: "var(--color-text-secondary)" }}>
          FEELDSCOPE は、OGN（Open Glider Network）の FLARM データおよび ADS-B データをリアルタイムに受信・表示するフライトモニターです。
          Raspberry Pi 上で動作し、滑空場周辺のグライダー・モーターグライダー・曳航機・周辺航空機の位置を地図上に表示します。
        </p>
        <Section heading="ナビゲーションバー（共通）">
          <ul className="list-disc ml-5 space-y-1 text-sm" style={{ color: "var(--color-text-secondary)" }}>
            <li><strong>FEELDSCOPE</strong> — アプリケーション名（左端）</li>
            <li><strong>滑空場名</strong> — 設定で登録した滑空場名を表示</li>
            <li><strong>マップ</strong> — マップ画面に切替</li>
            <li><strong>ステータス</strong> — システム・受信機の稼働状況画面に切替</li>
            <li><strong>設定</strong> — 各種設定画面に切替</li>
            <li><strong>OGN設定</strong> — OGN受信機専用の設定画面に切替</li>
            <li><strong>機体情報</strong> — 機体データベース管理画面に切替</li>
            <li><strong>ヘルプ</strong> — マニュアル / リリースノート / バージョン情報をポップアップ表示</li>
            <li><strong>時計</strong> — 現在時刻をリアルタイム表示（右端）</li>
          </ul>
        </Section>
      </Card>

      {/* ===== 1. マップ画面 ===== */}
      <Card title="1. マップ画面">
        <Section heading="マップ操作">
          <ul className="list-disc ml-5 space-y-1 text-sm" style={{ color: "var(--color-text-secondary)" }}>
            <li><strong>ドラッグ</strong> — 地図を平行移動</li>
            <li><strong>マウスホイール / ピンチ</strong> — 拡大縮小</li>
            <li><strong>右下の +/− ボタン</strong> — ズーム</li>
            <li><strong>機体クリック</strong> — その機体を選択し、サイドバーで詳細表示</li>
          </ul>
        </Section>
        <Section heading="HOMEボタン・保存ボタン（マップ右上）">
          <ul className="list-disc ml-5 space-y-1 text-sm" style={{ color: "var(--color-text-secondary)" }}>
            <li><strong>HOME</strong> — 保存済みの「HOMEビュー」（地図中心位置・ズーム）に瞬時に戻ります。未保存時は滑空場設定の位置を表示</li>
            <li><strong>保存</strong> — 現在表示中の地図の中心位置とズームを「HOMEビュー」として保存（ブラウザに保存）。次回起動時もこの位置から開始</li>
          </ul>
        </Section>
        <Section heading="サイドバー（左）">
          <p className="text-sm mb-2" style={{ color: "var(--color-text-secondary)" }}>機体を4カテゴリで一覧表示：</p>
          <ul className="list-disc ml-5 space-y-1 text-sm" style={{ color: "var(--color-text-secondary)" }}>
            <li><strong>警告</strong> — パス不足（赤）または着陸進入中（橙）の機体</li>
            <li><strong>上空</strong> — 飛行中の通常機体（緑）</li>
            <li><strong>ADS-B</strong> — 受信したADS-B / Mode-S/C機体</li>
            <li><strong>地上</strong> — 地表付近で停止している機体</li>
            <li><strong>幅変更</strong> — サイドバーとマップの境界をドラッグで幅変更可能（ブラウザ保存）</li>
          </ul>
        </Section>
        <Section heading="機体アイコン一覧">
          <table className="w-full text-sm mt-2" style={{ borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "var(--color-bg-primary)" }}>
                <th className="text-left px-2 py-1 text-xs" style={{ borderBottom: "1px solid var(--color-border)", color: "var(--color-text-secondary)" }}>アイコン</th>
                <th className="text-left px-2 py-1 text-xs" style={{ borderBottom: "1px solid var(--color-border)", color: "var(--color-text-secondary)" }}>種別</th>
                <th className="text-left px-2 py-1 text-xs" style={{ borderBottom: "1px solid var(--color-border)", color: "var(--color-text-secondary)" }}>説明</th>
              </tr>
            </thead>
            <tbody>
              {ICON_TABLE.map((row, i) => (
                <tr key={i} style={{ borderBottom: "1px solid var(--color-border)" }}>
                  <td className="px-2 py-1" dangerouslySetInnerHTML={{ __html: row.svg }} />
                  <td className="px-2 py-1"><strong>{row.label}</strong></td>
                  <td className="px-2 py-1 text-xs" style={{ color: "var(--color-text-secondary)" }}>{row.desc}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
        <Section heading="機体アイコンの色分け">
          <ul className="list-disc ml-5 space-y-1 text-sm" style={{ color: "var(--color-text-secondary)" }}>
            <li><span style={{ color: "#4caf50", fontWeight: 600 }}>緑</span> — 通常飛行中</li>
            <li><span style={{ color: "#ff9800", fontWeight: 600 }}>橙</span> — 低高度・着陸進入中（着陸確定後に緑へ復帰）</li>
            <li><span style={{ color: "#f44336", fontWeight: 600 }}>赤・点滅</span> — パス不足（滑空場に安全に帰還できない高度）</li>
            <li><span style={{ color: "#1565c0", fontWeight: 600 }}>青</span> — ADS-B受信機体</li>
            <li><span style={{ color: "#222", fontWeight: 600 }}>黒</span> — Mode-S/Mode-C機体</li>
          </ul>
        </Section>
        <Section heading="パス判定（安全滑空比による警告）">
          <p className="text-sm" style={{ color: "var(--color-text-secondary)" }}>
            各機体の現在地から滑空場までの距離 ÷（現在高度 − 滑空場標高）で滑空比を計算し、設定値（デフォルト15:1）を超えると赤点滅で警告します。
            数字が大きいほど効率の良い滑空が必要なことを意味します。
          </p>
        </Section>
        <Section heading="フライトログテーブル（マップ下部）">
          <p className="text-sm mb-2" style={{ color: "var(--color-text-secondary)" }}>FLARM受信機の自動検知でフライトを記録：</p>
          <ul className="list-disc ml-5 space-y-1 text-sm" style={{ color: "var(--color-text-secondary)" }}>
            <li><strong>#</strong> — 行番号</li>
            <li><strong>登録番号</strong> — 機体登録番号（機体DB登録があれば表示）</li>
            <li><strong>離陸</strong> — 離陸時刻 HH:MM（手動編集可）</li>
            <li><strong>着陸</strong> — 着陸時刻 HH:MM（飛行中は「飛行中」と表示）</li>
            <li><strong>飛行時間</strong> — 自動計算 HH+MM 形式</li>
            <li><strong>離脱高度</strong> — 曳航離脱時の高度（手動編集可）</li>
            <li><strong>離脱距離</strong> — 離脱時の滑空場からの距離</li>
            <li><strong>🗑 削除ボタン</strong> — その行を削除（確認ダイアログあり）</li>
            <li><strong>テーブル高さ</strong> — マップとの境界をドラッグで変更可能（ブラウザ保存）</li>
          </ul>
          <p className="text-xs mt-2" style={{ color: "var(--color-text-secondary)" }}>
            データはサーバ側メモリに保存され、毎日 <strong>日本時間 AM 5:00</strong> に自動リセット。複数端末で同じログを参照できます。
          </p>
        </Section>
        <Section heading="自動検知の閾値">
          <ul className="list-disc ml-5 space-y-1 text-sm" style={{ color: "var(--color-text-secondary)" }}>
            <li><strong>離陸検知</strong> — 対地速度が <strong>30 km/h</strong> を超えた瞬間</li>
            <li><strong>着陸検知</strong> — 一度 1500ft AGL を超えた機体が、1500ft AGL以下かつ <strong>10 km/h以下</strong> になった瞬間</li>
            <li><strong>離脱検知（グライダー）</strong> — 旋回率8°/s以上 + 速度低下10 km/h以上 + 高度500ft AGL以上</li>
            <li><strong>離脱検知（曳航機）</strong> — 高度ピークから50m以上の降下</li>
          </ul>
        </Section>
      </Card>

      {/* ===== 2. ステータス画面 ===== */}
      <Card title="2. ステータス画面">
        <p className="text-sm mb-2" style={{ color: "var(--color-text-secondary)" }}>
          5秒間隔で自動更新されるシステム・受信状況のダッシュボード。読み取り専用。
        </p>

        <Section heading="システム概要">
          <table className="w-full text-sm" style={{ borderCollapse: "collapse" }}><tbody>
            <ManualRow label="受信機名" desc="OGN受信機の識別名（APRS Call）" />
            <ManualRow label="稼働時間" desc="OS起動からの経過時間" />
            <ManualRow label="CPU負荷" desc="1分 / 5分 / 15分の平均負荷率（1.0でCPU 1コアフル稼働相当）" />
            <ManualRow label="CPU温度" desc="60°C以上で橙色、70°C以上で赤色警告" />
            <ManualRow label="RAM 使用 / 空き" desc="メモリの使用量・空き容量（空きが少ない場合は再起動を推奨）" />
            <ManualRow label="ディスク使用" desc="ルートパーティションの使用量と使用率" />
          </tbody></table>
        </Section>

        <Section heading="OGN受信機">
          <table className="w-full text-sm" style={{ borderCollapse: "collapse" }}><tbody>
            <ManualRow label="状態" desc="rtlsdr-ognの稼働状況（HTTP 8082応答可否）" />
            <ManualRow label="ソフトウェア" desc="rtlsdr-ognのバージョンとビルド日" />
            <ManualRow label="Live Time" desc="OGN受信機が信号処理に費やしている時間の比率（高いほどCPU余裕なし）" />
            <ManualRow label="中心周波数（実測）" desc="実際にRTL-SDRが受信している周波数" />
            <ManualRow label="周波数補正（実測）" desc="GSM校正後の補正値" />
            <ManualRow label="周波数プラン" desc="使用中の周波数規格（日本は7: Japan）" />
            <ManualRow label="OGN受信ゲイン" desc="自動ゲイン制御後の現在値" />
            <ManualRow label="ノイズレベル" desc="周辺雑音レベル（小さいほど受信良好、3〜6dB程度が理想）" />
            <ManualRow label="NTP誤差" desc="ネットワーク時刻同期との誤差。FLARMはタイムスロット方式なので時刻精度が重要" />
            <ManualRow label="NTP周波数補正" desc="システムクロックの周波数補正値" />
            <ManualRow label="RTL-SDR" desc="使用中のRTL-SDRデバイス名・チューナー型番" />
          </tbody></table>
        </Section>

        <Section heading="ADS-B 受信ステータス">
          <table className="w-full text-sm" style={{ borderCollapse: "collapse" }}><tbody>
            <ManualRow label="状態" desc="正常受信中 / 失敗（連続失敗回数を表示）" />
            <ManualRow label="最終取得" desc="最後にtar1090エンドポイントから取得した時刻からの経過" />
            <ManualRow label="取得元URL" desc="設定で指定したaircraft.jsonのURL" />
            <ManualRow label="ポーリング間隔" desc="取得頻度（秒）" />
            <ManualRow label="応答時間" desc="HTTP応答までのミリ秒（小さいほど良好）" />
            <ManualRow label="累計ポーリング" desc="サービス起動以降の成功 / 全試行回数" />
            <ManualRow label="位置あり機体" desc="緯度経度を持つADS-B機体数（マップに表示される）" />
            <ManualRow label="位置なし機体（Mode-S/C）" desc="位置情報を持たない機体数（サイドバー上空欄に表示）" />
            <ManualRow label="合計受信機体" desc="位置あり＋位置なしの総数" />
            <ManualRow label="受信開始" desc="adsb-pollerサービスが開始してからの経過時間" />
            <ManualRow label="最終エラー" desc="最新の取得失敗時のエラー詳細（成功中は表示なし）" />
          </tbody></table>
        </Section>

        <Section heading="サービス稼働状況">
          <table className="w-full text-sm" style={{ borderCollapse: "collapse" }}><tbody>
            <ManualRow label="mosquitto" desc="MQTTブローカー（FEELDSCOPE全体の通信ハブ）" />
            <ManualRow label="ogn-mqtt" desc="OGN受信機からのデータをMQTTに変換して配信" />
            <ManualRow label="igc-simulator" desc="IGCファイル履歴再生サービス（リアルタイム再生時は停止）" />
            <ManualRow label="adsb-poller" desc="tar1090からADS-Bデータを定期取得してMQTTに配信" />
            <ManualRow label="feeldscope-webapp" desc="本Webアプリケーション" />
            <ManualRow label="avahi-daemon" desc="mDNS（&lt;hostname&gt;.local 名前解決）デーモン" />
            <ManualRow label="rtlsdr-ogn (init.d)" desc="OGNのRF受信・デコードプロセス（init.d管理）" />
            <ManualRow label="稼働時間" desc="各サービスの起動からの経過時間" />
          </tbody></table>
        </Section>

        <Section heading="フライトログ統計（本日）">
          <table className="w-full text-sm" style={{ borderCollapse: "collapse" }}><tbody>
            <ManualRow label="総記録数" desc="本日記録されたフライト総数（離陸検知＋編集追加）" />
            <ManualRow label="飛行中" desc="現在飛行中（着陸時刻が未記録）の機体数" />
            <ManualRow label="着陸済み" desc="着陸時刻が記録された機体数" />
          </tbody></table>
          <p className="text-xs mt-2" style={{ color: "var(--color-text-secondary)" }}>
            毎日 日本時間 AM 5:00 にサーバ側で自動リセット。webapp再起動でもクリア。
          </p>
        </Section>
      </Card>

      {/* ===== 3. 設定画面 ===== */}
      <Card title="3. 設定画面">
        <p className="text-sm mb-3" style={{ color: "var(--color-text-secondary)" }}>
          画面の上から順に解説します。保存先の種別:
          <strong>ブラウザ</strong>＝当該ブラウザのlocalStorageのみ /
          <strong>サーバ</strong>＝Pi上のファイル（全端末で共有） /
          <strong>ブラウザ + サーバ</strong>＝両方に保存（読込時はサーバ優先）
        </p>

        <Section heading="3-1. 滑空場設定">
          <ul className="list-disc ml-5 space-y-1 text-sm" style={{ color: "var(--color-text-secondary)" }}>
            <li><strong>滑空場名</strong>（ブラウザ + サーバ） — マップ中心位置のラベル、ナビゲーションバーに表示</li>
            <li><strong>緯度（°）</strong>（ブラウザ + サーバ） — 十進法。マップ初期表示・パス判定の基準</li>
            <li><strong>経度（°）</strong>（ブラウザ + サーバ） — 十進法</li>
            <li><strong>標高（m）</strong>（ブラウザ + サーバ） — パス判定で使用する基準高度</li>
          </ul>
        </Section>

        <Section heading="3-2. データソース切替">
          <ul className="list-disc ml-5 space-y-1 text-sm" style={{ color: "var(--color-text-secondary)" }}>
            <li><strong>リアルタイム再生</strong>ボタン — OGN FLARMデータ受信モードに切替（ogn-mqtt起動）</li>
            <li><strong>履歴再生</strong>ボタン — IGCファイル再生モード（igc-simulator起動、ogn-mqtt停止）</li>
            <li><strong>再生倍速スライダー</strong>（ブラウザ） — 1〜20倍速。履歴再生中はスライダー操作で即時反映</li>
            <li><strong>停止する</strong>リンク — 現在のモードを停止</li>
          </ul>
          <p className="text-xs mt-2" style={{ color: "var(--color-text-secondary)" }}>
            履歴再生中も OGN受信機（rtlsdr-ogn）は独立稼働しており、FLARMデータのOGNサーバへのアップロードは継続されます。
          </p>
        </Section>

        <Section heading="3-3. IGC ファイル管理（履歴再生用）">
          <ul className="list-disc ml-5 space-y-1 text-sm" style={{ color: "var(--color-text-secondary)" }}>
            <li><strong>IGC ファイルをアップロード</strong>ボタン — 拡張子 .igc のファイルをサーバに保存</li>
            <li><strong>削除</strong>ボタン — 各ファイルを削除（確認ダイアログ）</li>
          </ul>
          <p className="text-xs mt-2" style={{ color: "var(--color-text-secondary)" }}>
            OLC（onlinecontest.org）等からダウンロードしたIGCを使用可能。
            記録時刻を現在時刻にずらして再生されるため、過去のフライトでも「今飛んでいる」ように表示。
          </p>
        </Section>

        <Section heading="3-4. ADS-B 受信設定">
          <ul className="list-disc ml-5 space-y-1 text-sm" style={{ color: "var(--color-text-secondary)" }}>
            <li><strong>ADS-B 受信を有効にする</strong>チェックボックス（ブラウザ + サーバ） — adsb-pollerサービスのON/OFF</li>
            <li><strong>tar1090 / dump1090 URL</strong>（ブラウザ + サーバ） — aircraft.jsonエンドポイント。デフォルト: <code>http://fr24.local/tar1090/data/aircraft.json</code></li>
            <li><strong>ポーリング間隔（秒）</strong>（ブラウザ + サーバ） — 1〜30秒</li>
          </ul>
        </Section>

        <Section heading="3-5. 表示設定">
          <ul className="list-disc ml-5 space-y-1 text-sm" style={{ color: "var(--color-text-secondary)" }}>
            <li><strong>機体ラベル表示名</strong>（ブラウザ） — コンテスト番号 / 登録番号 / パイロット名 切替</li>
            <li><strong>高度</strong>（ブラウザ） — m / ft</li>
            <li><strong>速度</strong>（ブラウザ） — km/h / knot</li>
            <li><strong>上昇率</strong>（ブラウザ） — m/s / knot/s</li>
            <li><strong>距離</strong>（ブラウザ） — km / nm</li>
            <li><strong>安全滑空比</strong>（ブラウザ） — パス判定の閾値（1〜100、デフォルト15）。値より大きい滑空比が必要な機体は赤点滅</li>
          </ul>
        </Section>

        <Section heading="3-6. ネットワーク設定">
          <ul className="list-disc ml-5 space-y-1 text-sm" style={{ color: "var(--color-text-secondary)" }}>
            <li><strong>ホスト名（mDNS）</strong> — 英数字とハイフンのみ、63文字以内。設定後 <code>&lt;name&gt;.local</code> でアクセス可能</li>
            <li><strong>Wi-Fi SSID</strong> — 接続先Wi-Fiネットワーク名</li>
            <li><strong>Wi-Fi パスワード</strong> — WPA2パスワード（8文字以上）</li>
            <li><strong>有線LAN: DHCP（自動）</strong> — ルーターから自動取得</li>
            <li><strong>有線LAN: 固定IP</strong> — IPアドレス・サブネットマスク・ゲートウェイ・DNSを手動指定</li>
            <li><strong>適用</strong>ボタン — 各設定の保存と即時反映</li>
          </ul>
          <div className="mt-2 p-2 rounded text-xs" style={{ background: "var(--color-warning-dim)", color: "var(--color-warning)", border: "1px solid var(--color-warning)" }}>
            <strong>⚠ 注意:</strong> 固定化(OverlayFS)がONの場合、ネットワーク設定の変更は再起動時にリセットされます。
            恒久的に変更するには先に固定化をOFFにしてください。誤った設定でアクセス不能になった場合はSDカードを取り出してPCから設定ファイル修正、または別系統で接続してください。
          </div>
        </Section>

        <Section heading="3-7. システムアップデート">
          <ul className="list-disc ml-5 space-y-1 text-sm" style={{ color: "var(--color-text-secondary)" }}>
            <li><strong>現在のバージョン</strong>表示 — 稼働中のwebappバージョン</li>
            <li><strong>「v X.Y.Z が利用可能」</strong>バッジ — GitHubリモートに新バージョンがある時に表示</li>
            <li><strong>「最新」</strong>バッジ — 利用可能な更新がない時</li>
            <li><strong>アップデート実行</strong>ボタン — クリックで <code>git pull</code> + <code>npm install</code> + <code>npm run build</code> + サービス再起動を自動実行</li>
            <li><strong>プログレスバー</strong> — 1/5〜5/5のステップを%で表示（約2〜3分）</li>
            <li><strong>完了メッセージ</strong> — 緑バナーで Shift + Ctrl + R によるハードリロードを促す</li>
          </ul>
          <div className="mt-2 p-2 rounded text-xs" style={{ background: "var(--color-warning-dim)", color: "var(--color-warning)", border: "1px solid var(--color-warning)" }}>
            <strong>⚠ 注意:</strong> 固定化(OverlayFS)がONの場合はアップデートできません。先に固定化をOFFにして再起動してください。
          </div>
        </Section>

        <Section heading="3-8. システムステータス">
          <p className="text-sm" style={{ color: "var(--color-text-secondary)" }}>
            読み取り専用。Mosquitto / ogn-mqtt / igc-simulator / adsb-poller の稼働状態を5秒間隔で表示（詳細はステータスタブで）。
          </p>
        </Section>

        <Section heading="3-9. システム固定化（OverlayFS）">
          <ul className="list-disc ml-5 space-y-1 text-sm" style={{ color: "var(--color-text-secondary)" }}>
            <li><strong>現在の状態</strong>表示 — ON（固定化中） / OFF（通常モード）</li>
            <li><strong>「固定化を有効にして再起動」</strong>ボタン — OverlayFSを有効化して再起動を1アクションで実行</li>
            <li><strong>「固定化を解除して再起動」</strong>ボタン — OverlayFSを解除して再起動を1アクションで実行</li>
          </ul>
          <p className="text-xs mt-2" style={{ color: "var(--color-text-secondary)" }}>
            <strong>固定化ON</strong>: SDカード書き込みが保護され、再起動で変更がリセット。電源断時のSDカード破損防止。<br />
            <strong>固定化OFF</strong>: 全変更が恒久保存されるが、電源断時にSDカード破損リスクあり。
          </p>
          <div className="mt-2 p-2 rounded text-xs" style={{ background: "var(--color-success-dim)", color: "var(--color-success)", border: "1px solid var(--color-success)" }}>
            <strong>推奨:</strong> 通常運用では固定化ONを推奨。設定変更が必要な時のみOFFに切替。
          </div>
        </Section>

        <Section heading="3-10. 自動再起動">
          <ul className="list-disc ml-5 space-y-1 text-sm" style={{ color: "var(--color-text-secondary)" }}>
            <li><strong>毎日決まった時刻に自動再起動する</strong>チェックボックス（サーバ） — 有効化するとcrontabに <code>MM HH * * * /sbin/reboot</code> を追加</li>
            <li><strong>時刻入力</strong>（HH:MM、システムローカルタイムゾーン基準）</li>
            <li><strong>適用</strong>ボタン — rootのcrontabを書き換え（既存の他のcron行は保持）</li>
          </ul>
          <p className="text-xs mt-2" style={{ color: "var(--color-text-secondary)" }}>
            毎日決まった時刻にシステム全体を再起動することで、メモリリークや一時ファイル蓄積を防止できます。
          </p>
        </Section>

        <Section heading="3-11. システム電源">
          <ul className="list-disc ml-5 space-y-1 text-sm" style={{ color: "var(--color-text-secondary)" }}>
            <li><strong>再起動</strong>ボタン — システム再起動（確認ダイアログあり）</li>
            <li><strong>シャットダウン</strong>ボタン — システム停止（再起動には電源抜き差しが必要）</li>
          </ul>
        </Section>
      </Card>

      {/* ===== 4. OGN設定画面 ===== */}
      <Card title="4. OGN設定画面">
        <p className="text-sm mb-2" style={{ color: "var(--color-text-secondary)" }}>
          OGN受信機（rtlsdr-ogn）の全設定をWeb GUIから変更できます。保存時は <code>/home/pi/rtlsdr-ogn.conf</code> と
          <code>/boot/OGN-receiver.conf</code> の両方を更新し、rtlsdr-ognサービスを自動再起動します（受信が数秒中断）。
        </p>

        <Section heading="受信機ステータス（リアルタイム）">
          <p className="text-sm" style={{ color: "var(--color-text-secondary)" }}>
            5秒間隔で自動更新。ステータスタブの「OGN受信機」と同じ項目に加え、
            ホスト名・CPU負荷・RAM空き・RTL-SDRシリアル番号・サンプルレートも表示。
          </p>
        </Section>

        <Section heading="受信機識別">
          <ul className="list-disc ml-5 space-y-1 text-sm" style={{ color: "var(--color-text-secondary)" }}>
            <li><strong>受信機名（APRS Call）</strong> — 英数字9文字以内。OGN命名規則に従う（日本: <code>ICAO空港コード + 連番</code>、例: <code>RJTTTK001</code>）</li>
          </ul>
        </Section>

        <Section heading="アンテナ設置位置">
          <ul className="list-disc ml-5 space-y-1 text-sm" style={{ color: "var(--color-text-secondary)" }}>
            <li><strong>緯度・経度（°）</strong> — アンテナの実際の設置位置。OGNネットワーク上の受信局位置として公開されます</li>
            <li><strong>高度（m）</strong> — アンテナ高度</li>
          </ul>
        </Section>

        <Section heading="RF（無線）設定">
          <ul className="list-disc ml-5 space-y-1 text-sm" style={{ color: "var(--color-text-secondary)" }}>
            <li><strong>FreqCorr（ppm）</strong> — RTL-SDRドングルの水晶誤差補正（R820T系は通常 40〜80 ppm）</li>
            <li><strong>HTTPポート</strong> — 受信機ステータスHTTPサーバのポート（デフォルト 8082）</li>
            <li><strong>GSM中心周波数（MHz）</strong> — 周波数キャリブレーション用（日本: 922.4MHz付近）</li>
            <li><strong>GSMゲイン（dB）</strong> — GSM受信時のRF入力ゲイン（GSM信号は強力なため低めに）</li>
            <li><strong>Bias-T 電源供給</strong>チェックボックス — アンテナ用LNAなどへの電源供給</li>
          </ul>
          <div className="mt-2 p-2 rounded text-xs" style={{ background: "var(--color-warning-dim)", color: "var(--color-warning)", border: "1px solid var(--color-warning)" }}>
            <strong>⚠ Bias-T警告:</strong> Bias-T対応のLNA等を使う場合のみ有効化してください。
            通常アンテナで有効化するとRTL-SDRドングルが故障する恐れがあります。
          </div>
        </Section>

        <Section heading="OGNバイナリURL">
          <p className="text-sm" style={{ color: "var(--color-text-secondary)" }}>
            <strong>OGNBINARYURL</strong> — OGNバイナリのダウンロード元URL。日本向けは <code>?version=japan</code> を付与。再インストール時に使用。
          </p>
        </Section>

        <Section heading="アクションボタン">
          <ul className="list-disc ml-5 space-y-1 text-sm" style={{ color: "var(--color-text-secondary)" }}>
            <li><strong>設定を保存して受信機を再起動</strong> — 設定変更を保存＋rtlsdr-ogn再起動</li>
            <li><strong>受信機のみ再起動</strong> — 設定は変更せずrtlsdr-ognだけ再起動</li>
          </ul>
        </Section>
      </Card>

      {/* ===== 5. 機体情報画面 ===== */}
      <Card title="5. 機体情報画面">
        <p className="text-sm mb-2" style={{ color: "var(--color-text-secondary)" }}>
          FLARMデバイスID（24bit hex）ごとに機体情報をデータベース管理。マップやフライトログでの表示に使用されます。
        </p>

        <Section heading="保存項目">
          <ul className="list-disc ml-5 space-y-1 text-sm" style={{ color: "var(--color-text-secondary)" }}>
            <li><strong>Device ID</strong> — FLARMの24bit ID（例: <code>DD1234</code>）</li>
            <li><strong>登録番号</strong> — JA番号など（例: <code>JA1234</code>）</li>
            <li><strong>コンテスト番号</strong> — CN（例: <code>AA</code>）</li>
            <li><strong>パイロット名</strong> — 操縦者名</li>
            <li><strong>機種</strong> — 機種名（例: ASW27）</li>
            <li><strong>航空機タイプ</strong> — グライダー / 曳航機 / 動力機 / ヘリ / パラ など。マップアイコンに反映</li>
          </ul>
        </Section>

        <Section heading="操作">
          <ul className="list-disc ml-5 space-y-1 text-sm" style={{ color: "var(--color-text-secondary)" }}>
            <li><strong>+ 新規追加</strong>ボタン — 機体情報を手動追加</li>
            <li><strong>編集</strong>ボタン — 既存レコードを編集</li>
            <li><strong>削除</strong>ボタン — レコード削除（確認ダイアログ）</li>
            <li>未登録のFLARM機体がマップに出現すると、Device IDだけが自動登録されます（後から登録番号等を追記可能）</li>
          </ul>
        </Section>

        <div className="mt-3 p-2 rounded text-xs" style={{ background: "var(--color-warning-dim)", color: "var(--color-warning)", border: "1px solid var(--color-warning)" }}>
          <strong>⚠ 固定化中の注意:</strong> OverlayFSがONの場合、追加・編集・削除した機体情報は再起動時にリセットされます（警告バッジ表示）。
          恒久保存したい場合は先に固定化をOFFにしてから操作してください。
        </div>
      </Card>
    </>
  );
}

function ManualRow({ label, desc }: { label: string; desc: string }) {
  return (
    <tr style={{ borderBottom: "1px solid var(--color-border)" }}>
      <td className="px-3 py-1.5 text-sm" style={{ width: "40%" }}><strong>{label}</strong></td>
      <td className="px-3 py-1.5 text-xs" style={{ color: "var(--color-text-secondary)" }}>{desc}</td>
    </tr>
  );
}

const ICON_TABLE: { svg: string; label: string; desc: string }[] = [
  { svg: `<svg width="24" height="24" viewBox="-15 -15 30 30"><path d="M0,-11 L.8,-3 L14,-0.5 L14,0.5 L.8,1.5 L.4,8 L2.5,9.5 L2.5,10.5 L-2.5,10.5 L-2.5,9.5 L-.4,8 L-.8,1.5 L-14,0.5 L-14,-0.5 L-.8,-3Z" fill="#4caf50" stroke="rgba(0,0,0,.4)" stroke-width=".5"/></svg>`, label: "グライダー / モーターグライダー", desc: "離着陸時刻と離脱高度の自動検知対象" },
  { svg: `<svg width="24" height="24" viewBox="-15 -15 30 30"><path d="M0,-12 L1.5,-4 L1.5,-2 L10,-2 L10,1 L1.5,1 L1,9 L4,10 L4,11.5 L-4,11.5 L-4,10 L-1,9 L-1.5,1 L-10,1 L-10,-2 L-1.5,-2 L-1.5,-4Z" fill="#4caf50" stroke="rgba(0,0,0,.4)" stroke-width=".5"/></svg>`, label: "曳航機", desc: "離着陸時刻と離脱高度の自動検知対象" },
  { svg: `<svg width="24" height="24" viewBox="-15 -15 30 30"><path d="M0,-11 L1.5,-4 L9,-1 L9,1 L1.5,2 L1,9 L3.5,10 L3.5,11 L-3.5,11 L-3.5,10 L-1,9 L-1.5,2 L-9,1 L-9,-1 L-1.5,-4Z" fill="#4caf50" stroke="rgba(0,0,0,.4)" stroke-width=".5"/><line x1="-3" y1="-12" x2="3" y2="-12" stroke="#4caf50" stroke-width="1.5" stroke-linecap="round"/></svg>`, label: "動力機", desc: "プロペラ機" },
  { svg: `<svg width="24" height="24" viewBox="-15 -15 30 30"><line x1="-12" y1="-10" x2="12" y2="-10" stroke="#4caf50" stroke-width="2" stroke-linecap="round"/><line x1="0" y1="-10" x2="0" y2="-6" stroke="#4caf50" stroke-width="1.2"/><circle cx="0" cy="-1" r="5.5" fill="#4caf50" stroke="rgba(0,0,0,.4)" stroke-width=".5"/><line x1="-4" y1="4.5" x2="-6" y2="10" stroke="#4caf50" stroke-width="1.5" stroke-linecap="round"/><line x1="4" y1="4.5" x2="6" y2="10" stroke="#4caf50" stroke-width="1.5" stroke-linecap="round"/><line x1="-7" y1="10" x2="-5" y2="10" stroke="#4caf50" stroke-width="1.5" stroke-linecap="round"/><line x1="5" y1="10" x2="7" y2="10" stroke="#4caf50" stroke-width="1.5" stroke-linecap="round"/></svg>`, label: "ヘリコプター", desc: "" },
  { svg: `<svg width="24" height="24" viewBox="-15 -15 30 30"><path d="M-10,-3 Q-5,-10 0,-10 Q5,-10 10,-3 L10,-1 Q5,-6 0,-6 Q-5,-6 -10,-1Z" fill="#4caf50" stroke="rgba(0,0,0,.4)" stroke-width=".5"/><line x1="-7" y1="-2" x2="0" y2="6" stroke="#4caf50" stroke-width=".7"/><line x1="7" y1="-2" x2="0" y2="6" stroke="#4caf50" stroke-width=".7"/><circle cx="0" cy="7" r="2" fill="#4caf50" stroke="rgba(0,0,0,.4)" stroke-width=".3"/></svg>`, label: "パラグライダー", desc: "" },
  { svg: `<svg width="24" height="24" viewBox="-15 -15 30 30"><path d="M0,-8 L12,6 Q0,2 -12,6Z" fill="#4caf50" stroke="rgba(0,0,0,.4)" stroke-width=".5" fill-opacity=".8"/><circle cx="0" cy="3" r="1.5" fill="#4caf50" stroke="rgba(0,0,0,.4)" stroke-width=".3"/></svg>`, label: "ハンググライダー", desc: "" },
  { svg: `<svg width="24" height="24" viewBox="-15 -15 30 30"><circle cx="0" cy="-6" r="3" fill="#4caf50" stroke="rgba(0,0,0,.4)" stroke-width=".5"/><line x1="0" y1="-3" x2="0" y2="5" stroke="#4caf50" stroke-width="2" stroke-linecap="round"/><line x1="-7" y1="-1" x2="7" y2="-1" stroke="#4caf50" stroke-width="1.5" stroke-linecap="round"/><line x1="0" y1="5" x2="-5" y2="11" stroke="#4caf50" stroke-width="1.5" stroke-linecap="round"/><line x1="0" y1="5" x2="5" y2="11" stroke="#4caf50" stroke-width="1.5" stroke-linecap="round"/></svg>`, label: "スカイダイバー", desc: "" },
  { svg: `<svg width="24" height="24" viewBox="-15 -15 30 30"><ellipse cx="0" cy="-3" rx="8" ry="10" fill="#4caf50" stroke="rgba(0,0,0,.4)" stroke-width=".5"/><line x1="-3" y1="7" x2="-2" y2="10" stroke="#4caf50" stroke-width=".7"/><line x1="3" y1="7" x2="2" y2="10" stroke="#4caf50" stroke-width=".7"/><rect x="-3" y="10" width="6" height="4" rx="1" fill="#4caf50" stroke="rgba(0,0,0,.4)" stroke-width=".4"/></svg>`, label: "バルーン", desc: "" },
  { svg: `<svg width="24" height="24" viewBox="-15 -15 30 30"><rect x="-3" y="-3" width="6" height="6" rx="1" fill="#4caf50" stroke="rgba(0,0,0,.4)" stroke-width=".5"/><line x1="-3" y1="-3" x2="-9" y2="-9" stroke="#4caf50" stroke-width="1.5"/><line x1="3" y1="-3" x2="9" y2="-9" stroke="#4caf50" stroke-width="1.5"/><line x1="-3" y1="3" x2="-9" y2="9" stroke="#4caf50" stroke-width="1.5"/><line x1="3" y1="3" x2="9" y2="9" stroke="#4caf50" stroke-width="1.5"/></svg>`, label: "UAV / ドローン", desc: "" },
  { svg: `<svg width="24" height="24" viewBox="-12 -12 24 24"><path d="M0,-10 L1.5,-4 L8,-1 L8,0.5 L1.5,1.5 L1,6 L3.5,7.5 L3.5,8.5 L-3.5,8.5 L-3.5,7.5 L-1,6 L-1.5,1.5 L-8,0.5 L-8,-1 L-1.5,-4Z" fill="#1565c0" stroke="rgba(255,255,255,.5)" stroke-width=".5"/></svg>`, label: "ADS-B（青） / Mode-S/C（黒）", desc: "tar1090経由のADS-B機体" },
  { svg: `<svg width="24" height="24" viewBox="-11 -11 22 22"><path d="M0,-9 L4,8 L0,5 L-4,8 Z" fill="#00b894" stroke="rgba(0,0,0,.5)" stroke-width="0.7"/><line x1="-3" y1="-2" x2="3" y2="-2" stroke="#00b894" stroke-width="1.2"/><line x1="-5" y1="-5" x2="5" y2="-5" stroke="#00b894" stroke-width="1.2"/></svg>`, label: "OGN受信機（アンテナ）", desc: "OGN設定の緯度経度に表示。緑=稼働中、グレー=停止" },
];

function ReleaseNotesContent() {
  return (
    <>
      {/* v1.1.3 */}
      <div className="flex items-center gap-3 mb-2">
        <span className="text-base font-bold" style={{ color: "var(--color-accent)" }}>v1.1.3</span>
        <span className="text-sm" style={{ color: "var(--color-text-secondary)" }}>2026-04-14</span>
        <span className="px-2 py-0.5 rounded text-xs font-medium" style={{ background: "var(--color-accent-light)", color: "var(--color-accent)" }}>最新</span>
      </div>

      <Card title="バージョン管理ポリシーの確立">
        <ul className="list-disc ml-5 space-y-1 text-sm" style={{ color: "var(--color-text-secondary)" }}>
          <li>「同じバージョン番号 = 全端末で完全に同じ状態」を保証するポリシーを採用</li>
          <li>あらゆるコード・ドキュメント変更ごとに必ずpatch番号を増分</li>
          <li>アップデート判定はバージョン文字列の差分で判定（v1.1.2のロジック変更を撤回）</li>
        </ul>
      </Card>

      <Card title="マニュアル全面刷新">
        <ul className="list-disc ml-5 space-y-1 text-sm" style={{ color: "var(--color-text-secondary)" }}>
          <li>5大項目（マップ / ステータス / 設定 / OGN設定 / 機体情報）に再構成</li>
          <li>マップアイコン11種類の一覧表（OGN受信機アンテナアイコン含む）</li>
          <li>ステータスタブの全項目を表形式で意味解説</li>
          <li>設定タブ全11セクションを個別解説、保存先（ブラウザ / サーバ / 両方）を明記</li>
          <li>HOME / 保存ボタン、Bias-T警告等の操作系も全てカバー</li>
        </ul>
      </Card>

      {/* v1.1.1 — 公式初回リリース */}
      <div className="flex items-center gap-3 mb-2 mt-6">
        <span className="text-base font-bold" style={{ color: "var(--color-accent)" }}>v1.1.1</span>
        <span className="text-sm" style={{ color: "var(--color-text-secondary)" }}>2026-04-14</span>
        <span className="px-2 py-0.5 rounded text-xs font-medium" style={{ background: "var(--color-bg-card)", color: "var(--color-text-secondary)" }}>初回公開リリース</span>
      </div>

      <Card title="マップ・受信機表示">
        <ul className="list-disc ml-5 space-y-1 text-sm" style={{ color: "var(--color-text-secondary)" }}>
          <li>OGN FLARM データのリアルタイム受信・マップ表示</li>
          <li>機体状態の色分け表示（緑: 通常、橙: 低高度/着陸進入中、赤: パス不足）</li>
          <li>パス判定（安全滑空比による帰還可否の警告・赤点滅）</li>
          <li>機体種別アイコン（グライダー / 曳航機 / 動力機 / ヘリ / パラ など）</li>
          <li>OGN受信機アイコンを設定座標に表示（稼働状態に応じた色）</li>
        </ul>
      </Card>

      <Card title="ADS-B 受信">
        <ul className="list-disc ml-5 space-y-1 text-sm" style={{ color: "var(--color-text-secondary)" }}>
          <li>tar1090 / dump1090 と連携した ADS-B / Mode-S / Mode-C 受信</li>
          <li>ADS-B 機体のマップ表示（青: ADS-B、黒: Mode-S/C）</li>
          <li>位置不明機体（Mode-S/C）のサイドバー表示</li>
        </ul>
      </Card>

      <Card title="フライトログ・履歴再生">
        <ul className="list-disc ml-5 space-y-1 text-sm" style={{ color: "var(--color-text-secondary)" }}>
          <li>離陸・着陸・曳航離脱の自動検知・記録</li>
          <li>飛行時間・離脱高度・離脱距離をリアルタイム表示・手動編集可</li>
          <li>サーバ側メモリで保存、毎日 日本時間 AM 5:00 に自動リセット</li>
          <li>IGC ファイルによる履歴再生（1〜20 倍速ループ）</li>
          <li>履歴再生中も OGN サーバへの実機データアップロードは継続</li>
        </ul>
      </Card>

      <Card title="設定タブ">
        <ul className="list-disc ml-5 space-y-1 text-sm" style={{ color: "var(--color-text-secondary)" }}>
          <li>滑空場設定（名前・位置・標高、ブラウザ+サーバ保存）</li>
          <li>表示設定（単位・ラベル・安全滑空比）</li>
          <li>ADS-B 受信設定（URL・ポーリング間隔）</li>
          <li>ネットワーク設定（mDNSホスト名 / Wi-Fi / 有線LAN DHCP・固定IP）</li>
          <li>システムアップデート（GitHubから最新版取得＋プログレス表示）</li>
          <li>システム固定化（OverlayFS、変更＋再起動を1アクション化）</li>
          <li>自動再起動（毎日決まった時刻に自動再起動）</li>
          <li>システム電源（再起動・シャットダウン）</li>
        </ul>
      </Card>

      <Card title="OGN設定タブ">
        <ul className="list-disc ml-5 space-y-1 text-sm" style={{ color: "var(--color-text-secondary)" }}>
          <li>OGN受信機の全設定をWeb GUIから変更可能</li>
          <li>受信機名（APRS Call）、緯度・経度・高度、周波数補正、GSM校正、Bias-T、HTTPポート、OGNバイナリURL</li>
          <li>受信機のリアルタイムステータス（ソフトウェアバージョン、CPU温度、NTP誤差、実測ゲイン、ノイズ、Live Time）</li>
        </ul>
      </Card>

      <Card title="ステータスタブ">
        <ul className="list-disc ml-5 space-y-1 text-sm" style={{ color: "var(--color-text-secondary)" }}>
          <li>システム概要（稼働時間、CPU負荷、CPU温度、RAM、ディスク）</li>
          <li>OGN受信機の詳細ステータス</li>
          <li>ADS-B受信の詳細統計（取得元URL、応答時間、累計成功率、機体数の内訳、連続失敗回数、最終エラー）</li>
          <li>全サービスの稼働状況と稼働時間</li>
          <li>フライトログ統計（本日の総数・飛行中・着陸済み）</li>
          <li>5秒間隔で自動更新</li>
        </ul>
      </Card>

      <Card title="機体情報タブ">
        <ul className="list-disc ml-5 space-y-1 text-sm" style={{ color: "var(--color-text-secondary)" }}>
          <li>FLARM デバイス ID ごとに機体情報（機種名、登録番号、コンテスト番号、パイロット名、航空機タイプ）を管理</li>
          <li>未登録の FLARM 機体がマップに出現すると自動でデバイス ID 登録</li>
        </ul>
      </Card>

      <Card title="システム基盤">
        <ul className="list-disc ml-5 space-y-1 text-sm" style={{ color: "var(--color-text-secondary)" }}>
          <li>Raspberry Pi 4/5 + RTL-SDR（922.4 MHz 日本向けバイナリ）</li>
          <li>Next.js 16 + React 19 によるWebフロントエンド</li>
          <li>Mosquitto MQTT ブローカー統合（WebSocket 対応、HTTPS環境では wss プロキシ対応）</li>
          <li>OverlayFS によるシステム固定化対応</li>
          <li>各種パスを環境変数で上書き可能（VPSデモ環境等にも対応）</li>
        </ul>
      </Card>
    </>
  );
}

function VersionContent() {
  const [version, setVersion] = useState<string>("...");
  useEffect(() => {
    fetch("/api/system")
      .then(r => r.json())
      .then(d => setVersion(d.version?.current || "unknown"))
      .catch(() => setVersion("unknown"));
  }, []);
  return (
    <>
      <Card title="バージョン情報">
        <div className="space-y-4">
          <div className="flex items-center gap-4">
            <span className="text-2xl font-bold tracking-widest" style={{ color: "var(--color-accent)" }}>FEELDSCOPE</span>
          </div>
          <p className="text-sm" style={{ color: "var(--color-text-secondary)" }}>OGN FLARM リアルタイムフライトモニター</p>
          <InfoRow label="バージョン" value={version} />
          <InfoRow label="リリース日" value="2026-04-14" />
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
          <InfoRow label="プラットフォーム" value="Raspberry Pi 4 / 5" />
          <InfoRow label="OS" value="Raspbian / Raspberry Pi OS (Linux)" />
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

/* ── Support tab ── */

type SupportStatus = "idle" | "collecting" | "done" | "error";

function SupportContent() {
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<SupportStatus>("idle");
  const [statusMsg, setStatusMsg] = useState("");

  function formatTs(d: Date): string {
    const p = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  }

  async function handleDownload() {
    if (!description.trim()) {
      setStatusMsg("不具合の内容を入力してください。");
      setStatus("error");
      return;
    }

    setStatus("collecting");
    setStatusMsg("データを収集中...");

    try {
      const [systemRes, statusRes, ognRes, flightRes, logsRes] = await Promise.allSettled([
        fetch("/api/system").then((r) => r.json()),
        fetch("/api/status").then((r) => r.json()),
        fetch("/api/ogn").then((r) => r.json()),
        fetch("/api/flight-log").then((r) => r.json()),
        fetch("/api/support/logs").then((r) => r.json()),
      ]);

      setStatusMsg("ZIPを生成中...");

      const JSZip = (await import("jszip")).default;
      const zip = new JSZip();
      const ts = new Date();
      const folder = zip.folder(`feeldscope-support-${formatTs(ts)}`)!;

      // report.txt — Claude向け診断フォーマット
      const lsEntries: string[] = [];
      try {
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i)!;
          lsEntries.push(`  ${k}: ${localStorage.getItem(k)}`);
        }
      } catch { /* sandboxed */ }

      const reportLines = [
        "=== FEELDSCOPE サポートリクエスト ===",
        `生成日時: ${ts.toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })} JST`,
        "",
        "【不具合の内容】",
        description.trim(),
        "",
        "【ブラウザ環境】",
        `URL: ${window.location.href}`,
        `User-Agent: ${navigator.userAgent}`,
        `言語: ${navigator.language}`,
        `画面解像度: ${screen.width}×${screen.height}`,
        `ウィンドウサイズ: ${window.innerWidth}×${window.innerHeight}`,
        "",
        "【ローカルストレージ設定】",
        ...(lsEntries.length ? lsEntries : ["  (なし)"]),
      ];
      folder.file("report.txt", reportLines.join("\n"));

      // JSON データファイル
      function settled(r: PromiseSettledResult<unknown>) {
        return r.status === "fulfilled" ? r.value : { __error: String((r as PromiseRejectedResult).reason) };
      }
      folder.file("system-info.json", JSON.stringify(settled(systemRes), null, 2));
      folder.file("realtime-status.json", JSON.stringify(settled(statusRes), null, 2));
      folder.file("ogn-receiver.json", JSON.stringify(settled(ognRes), null, 2));
      folder.file("flight-log.json", JSON.stringify(settled(flightRes), null, 2));

      // systemdログ — サービス別テキストファイル
      const logsFolder = folder.folder("systemd-logs")!;
      if (logsRes.status === "fulfilled") {
        const logs = logsRes.value as { services: Record<string, string>; system_errors: string; system_info: string };
        for (const [svc, text] of Object.entries(logs.services ?? {})) {
          logsFolder.file(`${svc}.txt`, text);
        }
        logsFolder.file("system-errors.txt", logs.system_errors ?? "");
        logsFolder.file("system-info.txt", logs.system_info ?? "");
      } else {
        logsFolder.file("fetch-error.txt", String((logsRes as PromiseRejectedResult).reason));
      }

      // ブラウザ情報JSON
      folder.file("browser-info.json", JSON.stringify({
        timestamp: ts.toISOString(),
        url: window.location.href,
        userAgent: navigator.userAgent,
        language: navigator.language,
        screen: { width: screen.width, height: screen.height },
        window: { width: window.innerWidth, height: window.innerHeight },
        localStorage: Object.fromEntries(lsEntries.map((l) => {
          const [k, ...v] = l.trim().split(": ");
          return [k, v.join(": ")];
        })),
      }, null, 2));

      const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 6 } });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `feeldscope-support-${formatTs(ts)}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      setStatus("done");
      setStatusMsg("ダウンロードしました。このZIPファイルをサポートへお送りください。");
    } catch (e: unknown) {
      setStatus("error");
      setStatusMsg(`エラーが発生しました: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  const isCollecting = status === "collecting";

  return (
    <>
      <Card title="サポートリクエスト">
        <div className="space-y-3 text-sm" style={{ color: "var(--color-text-secondary)" }}>
          <p>不具合の内容を入力し、診断ファイルをダウンロードしてください。</p>
          <p>ダウンロードされたZIPファイルにはシステムの状態・ログが含まれています。このファイルをサポート担当者へお送りいただくことで、問題の特定が容易になります。</p>
        </div>
      </Card>

      <Card title="不具合の内容">
        <textarea
          value={description}
          onChange={(e) => { setDescription(e.target.value); if (status === "error" && e.target.value.trim()) { setStatus("idle"); setStatusMsg(""); } }}
          placeholder={"例：マップに航空機が表示されない\n例：OGN受信機のステータスがエラーになる\n\n発生状況や手順もできるだけ詳しく記入してください。"}
          rows={6}
          disabled={isCollecting}
          className="w-full text-sm rounded p-3 resize-none"
          style={{
            background: "var(--color-bg-primary)",
            border: `1px solid ${status === "error" && !description.trim() ? "var(--color-danger)" : "var(--color-border)"}`,
            color: "var(--color-text-primary)",
            outline: "none",
            fontFamily: "inherit",
          }}
        />
      </Card>

      <Card title="診断ファイルに含まれる情報">
        <ul className="text-sm space-y-1" style={{ color: "var(--color-text-secondary)" }}>
          {[
            ["report.txt", "不具合の内容・ブラウザ環境・ローカルストレージ設定"],
            ["system-info.json", "バージョン・設定値・サービス稼働状態"],
            ["realtime-status.json", "MQTT経由のリアルタイムデータ"],
            ["ogn-receiver.json", "OGN受信機のCPU・温度・RF状態"],
            ["flight-log.json", "当日のフライトログ"],
            ["systemd-logs/", "各サービスのsystemdログ・システムエラー"],
            ["browser-info.json", "画面サイズ・URL等のブラウザ情報"],
          ].map(([name, desc]) => (
            <li key={name} className="flex gap-2">
              <code className="shrink-0 text-xs px-1 rounded" style={{ background: "var(--color-bg-card)", color: "var(--color-accent)" }}>{name}</code>
              <span>{desc}</span>
            </li>
          ))}
        </ul>
        <p className="text-xs mt-3" style={{ color: "var(--color-text-secondary)" }}>
          ※ パスワード・秘密鍵等のセキュリティ情報は含まれません。機体DB・フライト乗員情報は含まれません。
        </p>
      </Card>

      <div className="flex flex-col gap-2">
        <button
          onClick={handleDownload}
          disabled={isCollecting}
          className="w-full py-2.5 text-sm font-semibold rounded transition-colors"
          style={{
            background: isCollecting ? "var(--color-border)" : "var(--color-accent)",
            color: isCollecting ? "var(--color-text-secondary)" : "#fff",
            cursor: isCollecting ? "not-allowed" : "pointer",
            border: "none",
          }}
        >
          {isCollecting ? "収集中..." : "診断ファイルをダウンロード (.zip)"}
        </button>

        {statusMsg && (
          <p
            className="text-sm text-center px-3 py-2 rounded"
            style={{
              color: status === "done" ? "var(--color-success)" : status === "error" ? "var(--color-danger)" : "var(--color-text-secondary)",
              background: "var(--color-bg-card)",
            }}
          >
            {statusMsg}
          </p>
        )}
      </div>
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
