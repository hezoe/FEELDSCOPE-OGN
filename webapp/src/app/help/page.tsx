"use client";

import React, { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

type HelpTab = "manual" | "release-notes" | "version" | "support";

const TABS: { key: HelpTab; label: string }[] = [
  { key: "manual", label: "マニュアル" },
  { key: "release-notes", label: "リリースノート" },
  { key: "version", label: "バージョン" },
  { key: "support", label: "サポート" },
];

export default function HelpPage() {
  return (
    <Suspense fallback={<div className="p-5 text-sm">読み込み中...</div>}>
      <HelpPageInner />
    </Suspense>
  );
}

function HelpPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tabParam = searchParams.get("tab");
  const tab: HelpTab = TABS.some((t) => t.key === tabParam) ? (tabParam as HelpTab) : "manual";
  const section = searchParams.get("section");
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    document.title = "FEELDSCOPE ヘルプ";
  }, []);

  useEffect(() => {
    if (!section || tab !== "manual") return;
    const timer = setTimeout(() => {
      const root = bodyRef.current;
      if (!root) return;
      const target = root.querySelector<HTMLElement>(`[data-help-id="${section}"]`);
      if (!target) return;
      target.scrollIntoView({ behavior: "smooth", block: "start" });
      target.classList.add("help-flash");
      setTimeout(() => target.classList.remove("help-flash"), 2200);
    }, 60);
    return () => clearTimeout(timer);
  }, [section, tab]);

  function switchTab(next: HelpTab) {
    router.replace(`/help?tab=${next}`);
  }

  return (
    <div className="flex flex-col h-screen" style={{ background: "var(--color-bg-primary)" }}>
      <div
        className="flex items-center shrink-0"
        style={{
          height: 40,
          background: "var(--color-bg-secondary)",
          borderBottom: "1px solid var(--color-border)",
        }}
      >
        <div
          className="flex items-center h-full shrink-0"
          style={{ paddingLeft: "1em", paddingRight: "1em", borderRight: "1px solid var(--color-border)" }}
        >
          <span className="text-sm font-semibold" style={{ color: "var(--color-text-primary)" }}>ヘルプ</span>
        </div>

        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => switchTab(t.key)}
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
      </div>

      <div ref={bodyRef} className="flex-1 overflow-y-auto p-5">
        <div className="max-w-2xl mx-auto space-y-4">
          {tab === "manual" && <ManualContent />}
          {tab === "release-notes" && <ReleaseNotesContent />}
          {tab === "version" && <VersionContent />}
          {tab === "support" && <SupportContent />}
        </div>
      </div>
    </div>
  );
}

/* ── Tab contents ── */

function ManualContent() {
  return (
    <>
      <Card id="manual-overview" title="FEELDSCOPE とは">
        <p className="text-sm leading-relaxed" style={{ color: "var(--color-text-secondary)" }}>
          FEELDSCOPE は、OGN（Open Glider Network）の FLARM データおよび ADS-B データをリアルタイムに受信・表示するフライトモニターです。
          Raspberry Pi 上で動作し、滑空場周辺のグライダー・モーターグライダー・曳航機・周辺航空機の位置を地図上に表示します。
        </p>
        <Section id="nav-bar" heading="ナビゲーションバー（共通）">
          <ul className="list-disc ml-5 space-y-1 text-sm" style={{ color: "var(--color-text-secondary)" }}>
            <li><strong>FEELDSCOPE</strong> — アプリケーション名（左端）</li>
            <li><strong>滑空場名</strong> — 設定で登録した滑空場名を表示</li>
            <li><strong>マップ</strong> — マップ画面に切替</li>
            <li><strong>ステータス</strong> — システム・受信機の稼働状況画面に切替</li>
            <li><strong>設定</strong> — 各種設定画面に切替</li>
            <li><strong>OGN設定</strong> — OGN受信機専用の設定画面に切替</li>
            <li><strong>機体情報</strong> — 機体データベース管理画面に切替</li>
            <li><strong>ヘルプ</strong> — マニュアル / リリースノート / バージョン情報を別ウィンドウで表示（メイン画面と並べて閲覧可能）</li>
            <li><strong>時計</strong> — 現在時刻をリアルタイム表示（右端）</li>
          </ul>
        </Section>
        <Section heading="マニュアルヘルプアイコン">
          <p className="text-sm" style={{ color: "var(--color-text-secondary)" }}>
            各画面のセクション見出しやボタンの横に小さな <strong>?</strong> アイコンが表示されている場合、クリックすると本マニュアルの該当箇所が別ウィンドウで開き、ハイライト付きで該当セクションに自動スクロールします。
          </p>
        </Section>
      </Card>

      {/* ===== 1. マップ画面 ===== */}
      <Card id="manual-map" title="1. マップ画面">
        <Section id="map-controls" heading="マップ操作">
          <ul className="list-disc ml-5 space-y-1 text-sm" style={{ color: "var(--color-text-secondary)" }}>
            <li><strong>ドラッグ</strong> — 地図を平行移動</li>
            <li><strong>マウスホイール / ピンチ</strong> — 拡大縮小</li>
            <li><strong>右下の +/− ボタン</strong> — ズーム</li>
            <li><strong>機体クリック</strong> — その機体を選択し、サイドバーで詳細表示</li>
          </ul>
        </Section>
        <Section id="map-home-save" heading="HOMEボタン・保存ボタン（マップ右上）">
          <ul className="list-disc ml-5 space-y-1 text-sm" style={{ color: "var(--color-text-secondary)" }}>
            <li><strong>HOME</strong> — 保存済みの「HOMEビュー」（地図中心位置・ズーム）に瞬時に戻ります。未保存時は滑空場設定の位置を表示</li>
            <li><strong>保存</strong> — 現在表示中の地図の中心位置とズームを「HOMEビュー」として保存（ブラウザに保存）。次回起動時もこの位置から開始</li>
          </ul>
        </Section>
        <Section id="map-sidebar" heading="サイドバー（左）">
          <p className="text-sm mb-2" style={{ color: "var(--color-text-secondary)" }}>機体を4カテゴリで一覧表示：</p>
          <ul className="list-disc ml-5 space-y-1 text-sm" style={{ color: "var(--color-text-secondary)" }}>
            <li><strong>警告</strong> — パス不足（赤）または着陸進入中（橙）の機体</li>
            <li><strong>上空</strong> — 飛行中の通常機体（緑）</li>
            <li><strong>ADS-B</strong> — 受信したADS-B / Mode-S/C機体</li>
            <li><strong>地上</strong> — 地表付近で停止している機体</li>
            <li><strong>幅変更</strong> — サイドバーとマップの境界をドラッグで幅変更可能（ブラウザ保存）</li>
          </ul>
        </Section>
        <Section id="map-icons" heading="機体アイコン一覧">
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
        <Section id="map-icon-colors" heading="機体アイコンの色分け">
          <ul className="list-disc ml-5 space-y-1 text-sm" style={{ color: "var(--color-text-secondary)" }}>
            <li><span style={{ color: "#4caf50", fontWeight: 600 }}>緑</span> — 通常飛行中</li>
            <li><span style={{ color: "#ff9800", fontWeight: 600 }}>橙</span> — 低高度・着陸進入中（着陸確定後に緑へ復帰）</li>
            <li><span style={{ color: "#f44336", fontWeight: 600 }}>赤・点滅</span> — パス不足（滑空場に安全に帰還できない高度）</li>
            <li><span style={{ color: "#1565c0", fontWeight: 600 }}>青</span> — ADS-B受信機体</li>
            <li><span style={{ color: "#222", fontWeight: 600 }}>黒</span> — Mode-S/Mode-C機体</li>
          </ul>
        </Section>
        <Section id="map-path-warning" heading="パス判定（安全滑空比による警告）">
          <p className="text-sm" style={{ color: "var(--color-text-secondary)" }}>
            各機体の現在地から滑空場までの距離 ÷（現在高度 − 滑空場標高）で滑空比を計算し、設定値（デフォルト15:1）を超えると赤点滅で警告します。
            数字が大きいほど効率の良い滑空が必要なことを意味します。
          </p>
        </Section>
        <Section id="map-flight-log" heading="フライトログテーブル（マップ下部）">
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
        <Section id="map-detection-thresholds" heading="自動検知の閾値">
          <ul className="list-disc ml-5 space-y-1 text-sm" style={{ color: "var(--color-text-secondary)" }}>
            <li><strong>離陸検知</strong> — 対地速度が <strong>30 km/h</strong> を超えた瞬間</li>
            <li><strong>着陸検知</strong> — 一度 1500ft AGL を超えた機体が、1500ft AGL以下かつ <strong>10 km/h以下</strong> になった瞬間</li>
            <li><strong>離脱検知（グライダー）</strong> — 旋回率8°/s以上 + 速度低下10 km/h以上 + 高度500ft AGL以上</li>
            <li><strong>離脱検知（曳航機）</strong> — 高度ピークから50m以上の降下</li>
          </ul>
        </Section>
      </Card>

      {/* ===== 2. ステータス画面 ===== */}
      <Card id="manual-status" title="2. ステータス画面">
        <p className="text-sm mb-2" style={{ color: "var(--color-text-secondary)" }}>
          5秒間隔で自動更新されるシステム・受信状況のダッシュボード。読み取り専用。
        </p>

        <Section id="status-system" heading="システム概要">
          <table className="w-full text-sm" style={{ borderCollapse: "collapse" }}><tbody>
            <ManualRow label="受信機名" desc="OGN受信機の識別名（APRS Call）" />
            <ManualRow label="稼働時間" desc="OS起動からの経過時間" />
            <ManualRow label="CPU負荷" desc="1分 / 5分 / 15分の平均負荷率（1.0でCPU 1コアフル稼働相当）" />
            <ManualRow label="CPU温度" desc="60°C以上で橙色、70°C以上で赤色警告" />
            <ManualRow label="RAM 使用 / 空き" desc="メモリの使用量・空き容量（空きが少ない場合は再起動を推奨）" />
            <ManualRow label="ディスク使用" desc="ルートパーティションの使用量と使用率" />
          </tbody></table>
        </Section>

        <Section id="status-ogn-receiver" heading="OGN受信機">
          <table className="w-full text-sm" style={{ borderCollapse: "collapse" }}><tbody>
            <ManualRow label="状態" desc="rtlsdr-ognの稼働状況（HTTP 8082応答可否）" />
            <ManualRow label="ソフトウェア" desc="rtlsdr-ognのバージョンとビルド日" />
            <ManualRow label="Live Time" desc="本来は信号処理に費やしているCPU時間の比率（v0.3.3.ARMでは表示バグで常に0.0%、実害なし）" />
            <ManualRow label="中心周波数（実測）" desc="実際にRTL-SDRが受信している周波数" />
            <ManualRow label="周波数補正（実測）" desc="水晶誤差補正の実測値（FreqCorr 設定値ベース）" />
            <ManualRow label="周波数プラン" desc="使用中の周波数規格（日本は7: Japan）" />
            <ManualRow label="AGC実行中ゲイン" desc="OGN内部AGCが現在使用しているゲイン値（標準環境で 25-40 dB あたりに収束）" />
            <ManualRow label="ノイズレベル" desc="OGN内部の参照に対するノイズ比。MinNoise(標準5)〜MaxNoise(標準10)の範囲に収まるようAGC調整" />
            <ManualRow label="DetectSNR" desc="FLARMパケットをデコードする閾値（標準3dB）。受信が振るわない場合下げる" />
            <ManualRow label="受信機体数（直近1分/1時間/12時間）" desc="OGN受信機がデコードできた機体数。「位置あり/合計」形式" />
            <ManualRow label="ポジション受信数（直近1分）" desc="デコード成功したFLARMポジションパケットの数。1機あたり毎秒1個程度が定常" />
            <ManualRow label="NTP誤差" desc="ネットワーク時刻同期との誤差。FLARMはタイムスロット方式なので時刻精度が重要" />
            <ManualRow label="NTP周波数補正" desc="システムクロックの周波数補正値" />
            <ManualRow label="RTL-SDR" desc="使用中のRTL-SDRデバイス名・チューナー型番" />
          </tbody></table>
        </Section>

        <Section id="status-adsb" heading="ADS-B 受信ステータス">
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

        <Section id="status-services" heading="サービス稼働状況">
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

        <Section id="status-flight-log-stats" heading="フライトログ統計（本日）">
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
      <Card id="manual-settings" title="3. 設定画面">
        <p className="text-sm mb-3" style={{ color: "var(--color-text-secondary)" }}>
          画面の上から順に解説します。保存先の種別:
          <strong>ブラウザ</strong>＝当該ブラウザのlocalStorageのみ /
          <strong>サーバ</strong>＝Pi上のファイル（全端末で共有） /
          <strong>ブラウザ + サーバ</strong>＝両方に保存（読込時はサーバ優先）
        </p>

        <Section id="settings-airfield" heading="3-1. 滑空場設定">
          <ul className="list-disc ml-5 space-y-1 text-sm" style={{ color: "var(--color-text-secondary)" }}>
            <li><strong>滑空場名</strong>（ブラウザ + サーバ） — マップ中心位置のラベル、ナビゲーションバーに表示</li>
            <li><strong>緯度（°）</strong>（ブラウザ + サーバ） — 十進法。マップ初期表示・パス判定の基準</li>
            <li><strong>経度（°）</strong>（ブラウザ + サーバ） — 十進法</li>
            <li><strong>標高（m）</strong>（ブラウザ + サーバ） — パス判定で使用する基準高度</li>
          </ul>
        </Section>

        <Section id="settings-source" heading="3-2. データソース切替">
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

        <Section id="settings-igc" heading="3-3. IGC ファイル管理（履歴再生用）">
          <ul className="list-disc ml-5 space-y-1 text-sm" style={{ color: "var(--color-text-secondary)" }}>
            <li><strong>IGC ファイルをアップロード</strong>ボタン — 拡張子 .igc のファイルをサーバに保存</li>
            <li><strong>削除</strong>ボタン — 各ファイルを削除(確認ダイアログ)</li>
          </ul>
          <p className="text-xs mt-2" style={{ color: "var(--color-text-secondary)" }}>
            OLC（onlinecontest.org）等からダウンロードしたIGCを使用可能。
            記録時刻を現在時刻にずらして再生されるため、過去のフライトでも「今飛んでいる」ように表示。
          </p>
        </Section>

        <Section id="settings-adsb" heading="3-4. ADS-B 受信設定">
          <ul className="list-disc ml-5 space-y-1 text-sm" style={{ color: "var(--color-text-secondary)" }}>
            <li><strong>ADS-B 受信を有効にする</strong>チェックボックス（ブラウザ + サーバ） — adsb-pollerサービスのON/OFF</li>
            <li><strong>tar1090 / dump1090 URL</strong>（ブラウザ + サーバ） — aircraft.jsonエンドポイント。デフォルト: <code>http://fr24.local/tar1090/data/aircraft.json</code></li>
            <li><strong>ポーリング間隔（秒）</strong>（ブラウザ + サーバ） — 1〜30秒</li>
          </ul>
        </Section>

        <Section id="settings-display" heading="3-5. 表示設定">
          <ul className="list-disc ml-5 space-y-1 text-sm" style={{ color: "var(--color-text-secondary)" }}>
            <li><strong>機体ラベル表示名</strong>（ブラウザ） — コンテスト番号 / 登録番号 / パイロット名 切替</li>
            <li><strong>高度</strong>（ブラウザ） — m / ft</li>
            <li><strong>速度</strong>（ブラウザ） — km/h / knot</li>
            <li><strong>上昇率</strong>（ブラウザ） — m/s / knot/s</li>
            <li><strong>距離</strong>（ブラウザ） — km / nm</li>
            <li><strong>安全滑空比</strong>（ブラウザ） — パス判定の閾値（1〜100、デフォルト15）。値より大きい滑空比が必要な機体は赤点滅</li>
          </ul>
        </Section>

        <Section id="settings-network" heading="3-6. ネットワーク設定">
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

        <Section id="settings-update" heading="3-7. システムアップデート">
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

        <Section id="settings-overlay" heading="3-8. システム固定化（OverlayFS）">
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

        <Section id="settings-autoreboot" heading="3-9. 自動再起動">
          <ul className="list-disc ml-5 space-y-1 text-sm" style={{ color: "var(--color-text-secondary)" }}>
            <li><strong>毎日決まった時刻に自動再起動する</strong>チェックボックス（サーバ） — 有効化するとcrontabに <code>MM HH * * * /sbin/reboot</code> を追加</li>
            <li><strong>時刻入力</strong>（HH:MM、システムローカルタイムゾーン基準）</li>
            <li><strong>適用</strong>ボタン — rootのcrontabを書き換え（既存の他のcron行は保持）</li>
          </ul>
          <p className="text-xs mt-2" style={{ color: "var(--color-text-secondary)" }}>
            毎日決まった時刻にシステム全体を再起動することで、メモリリークや一時ファイル蓄積を防止できます。
          </p>
        </Section>

        <Section id="settings-power" heading="3-10. システム電源">
          <ul className="list-disc ml-5 space-y-1 text-sm" style={{ color: "var(--color-text-secondary)" }}>
            <li><strong>再起動</strong>ボタン — システム再起動（確認ダイアログあり）</li>
            <li><strong>シャットダウン</strong>ボタン — システム停止（再起動には電源抜き差しが必要）</li>
          </ul>
        </Section>
      </Card>

      {/* ===== 4. OGN設定画面 ===== */}
      <Card id="manual-ogn" title="4. OGN設定画面">
        <p className="text-sm mb-2" style={{ color: "var(--color-text-secondary)" }}>
          OGN受信機（rtlsdr-ogn）の全設定をWeb GUIから変更できます。保存時は <code>/home/pi/rtlsdr-ogn.conf</code> と
          <code>/boot/OGN-receiver.conf</code> の両方を更新し、rtlsdr-ognサービスを自動再起動します（受信が数秒中断）。
        </p>

        <Section id="ogn-status" heading="受信機ステータス（リアルタイム）">
          <p className="text-sm" style={{ color: "var(--color-text-secondary)" }}>
            5秒間隔で自動更新。ステータスタブの「OGN受信機」と同じ項目に加え、
            ホスト名・CPU負荷・RAM空き・RTL-SDRシリアル番号・サンプルレートも表示。
          </p>
        </Section>

        <Section id="ogn-identity" heading="受信機識別">
          <ul className="list-disc ml-5 space-y-1 text-sm" style={{ color: "var(--color-text-secondary)" }}>
            <li><strong>受信機名（APRS Call）</strong> — 英数字9文字以内。OGN命名規則に従う（日本: <code>ICAO空港コード + 連番</code>、例: <code>RJTTTK001</code>）</li>
          </ul>
        </Section>

        <Section id="ogn-position" heading="アンテナ設置位置">
          <ul className="list-disc ml-5 space-y-1 text-sm" style={{ color: "var(--color-text-secondary)" }}>
            <li><strong>緯度・経度（°）</strong> — アンテナの実際の設置位置。OGNネットワーク上の受信局位置として公開されます</li>
            <li><strong>高度（m）</strong> — アンテナ高度</li>
          </ul>
        </Section>

        <Section id="ogn-rf" heading="RF（無線）基本設定">
          <ul className="list-disc ml-5 space-y-1 text-sm" style={{ color: "var(--color-text-secondary)" }}>
            <li><strong>FreqCorr（ppm）</strong> — RTL-SDRドングルの水晶誤差補正（R820T系は通常 40〜80 ppm、0でも実用上問題なし）</li>
            <li><strong>HTTPポート</strong> — 受信機ステータスHTTPサーバのポート（デフォルト 8082）</li>
            <li><strong>Bias-T 電源供給</strong>チェックボックス — アンテナ用LNAなどへの電源供給</li>
          </ul>
          <div className="mt-2 p-2 rounded text-xs" style={{ background: "var(--color-warning-dim)", color: "var(--color-warning)", border: "1px solid var(--color-warning)" }}>
            <strong>⚠ Bias-T警告:</strong> Bias-T対応のLNA等を使う場合のみ有効化してください。
            通常アンテナで有効化するとRTL-SDRドングルが故障する恐れがあります。
          </div>
        </Section>

        <Section id="ogn-agc" heading="AGC（自動利得制御）・デコーダ設定">
          <p className="text-sm mb-3" style={{ color: "var(--color-text-secondary)" }}>
            <strong>AGC（Automatic Gain Control / 自動利得制御）</strong>とは、受信機が周辺の電波環境に応じて
            アンプの増幅率（ゲイン）を自動調整する仕組みです。OGN-RFには独自の <strong>noise-window AGC</strong> が組み込まれており、
            測定したノイズレベルが <code>MinNoise</code>〜<code>MaxNoise</code> の範囲に収まるようにゲインを上下にステップさせます。
          </p>

          <div className="p-3 rounded text-xs mb-3" style={{ background: "var(--color-bg-card)", border: "1px solid var(--color-border)" }}>
            <strong>📊 AGCの動作ロジック：</strong>
            <ul className="list-disc ml-5 mt-1 space-y-0.5">
              <li>実測ノイズ <strong>&lt; MinNoise</strong> → 「環境が静かすぎる、ゲインを上げて環境ノイズを聞き取る」→ ゲイン↑</li>
              <li>実測ノイズ <strong>&gt; MaxNoise</strong> → 「ゲイン上げすぎで自己ノイズが暴れている」→ ゲイン↓</li>
              <li>実測ノイズが範囲内 → ゲイン維持</li>
            </ul>
            <p className="mt-2">
              これにより、アンテナ利得や設置環境に応じて<strong>自動的に最適なゲインに収束</strong>します。
              ステータスタブの「AGC実行中ゲイン」「ノイズレベル」で現在の状態が観察できます。
            </p>
          </div>

          <p className="text-sm font-semibold mb-1" style={{ color: "var(--color-text-primary)" }}>各パラメータ</p>
          <ul className="list-disc ml-5 space-y-1 text-sm" style={{ color: "var(--color-text-secondary)" }}>
            <li>
              <strong>Initial Gain（dB）</strong> — AGC起動時のゲイン初期値。標準: <code>7.7</code>。
              低めにしておくと、受信機のすぐ近くにFLARM端末があってもADC飽和を避けられる。
              実動作中はAGCが勝手にステップアップする。
            </li>
            <li>
              <strong>DetectSNR（dB）</strong> — FLARMパケットを「有効」と判断する SNR（信号対ノイズ比）の閾値。
              標準: <code>3.0</code>。下げる（例: 2.5）→ 弱信号も拾えるが誤検出も増える。上げる（例: 6.0）→ 確実な信号のみ取るが取りこぼし増。
            </li>
            <li>
              <strong>MinNoise（dB）</strong> — AGCの「最低ノイズ目標」。標準: <code>5.0</code>。
              高くするほど AGC がゲインを高い側に押し上げる。<strong>弱信号環境ではこれを上げる</strong>のが効く（5→8）。
            </li>
            <li>
              <strong>MaxNoise（dB）</strong> — AGCの「最大許容ノイズ」。標準: <code>10.0</code>。
              低すぎると AGC のヘッドルームが狭くなる。<strong>高ノイズ環境ではこれを下げる</strong>（10→8）と過剰増幅を防げる。
            </li>
          </ul>

          <p className="text-sm font-semibold mt-4 mb-1" style={{ color: "var(--color-text-primary)" }}>調整ガイド</p>
          <table className="w-full text-xs mt-1" style={{ borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ borderBottom: "1px solid var(--color-border)" }}>
                <th className="text-left py-1 px-2" style={{ color: "var(--color-text-secondary)" }}>環境 / 症状</th>
                <th className="text-left py-1 px-2" style={{ color: "var(--color-text-secondary)" }}>推奨パラメータ</th>
                <th className="text-left py-1 px-2" style={{ color: "var(--color-text-secondary)" }}>判断材料</th>
              </tr>
            </thead>
            <tbody style={{ color: "var(--color-text-secondary)" }}>
              <tr style={{ borderBottom: "1px solid var(--color-border)" }}>
                <td className="py-1 px-2"><strong>標準</strong>（滑空場・郊外）</td>
                <td className="py-1 px-2 font-mono">Min=5 Max=10 SNR=3</td>
                <td className="py-1 px-2">プリセット「標準」</td>
              </tr>
              <tr style={{ borderBottom: "1px solid var(--color-border)" }}>
                <td className="py-1 px-2"><strong>弱信号</strong>（遠距離機体重視 / 受信機体ゼロ）</td>
                <td className="py-1 px-2 font-mono">Min=8 Max=15 SNR=2.5</td>
                <td className="py-1 px-2">AGC実行中ゲインが MAX(49.6)に張り付き、機体ゼロ</td>
              </tr>
              <tr style={{ borderBottom: "1px solid var(--color-border)" }}>
                <td className="py-1 px-2"><strong>高ノイズ</strong>（都市部 / 強い干渉源近接）</td>
                <td className="py-1 px-2 font-mono">Min=3 Max=8 SNR=5</td>
                <td className="py-1 px-2">AGC実行中ゲインが低位（10dB以下）固定 / ノイズが10超え常態</td>
              </tr>
              <tr style={{ borderBottom: "1px solid var(--color-border)" }}>
                <td className="py-1 px-2"><strong>近接FLARM試験</strong>（端末を1m以内）</td>
                <td className="py-1 px-2 font-mono">Initial=0 SNR=6</td>
                <td className="py-1 px-2">飽和回避のため AGC スタートを最低に、誤検出抑制で SNR 厳しめ</td>
              </tr>
            </tbody>
          </table>

          <div className="mt-3 p-2 rounded text-xs" style={{ background: "var(--color-warning-dim)", color: "var(--color-warning)", border: "1px solid var(--color-warning)" }}>
            <strong>💡 調整のコツ：</strong> 一度に1つのパラメータだけ動かす。「設定を保存」後 AGC 再収束に約1分。
            ステータスの「受信機体数（直近1分）」で効果判定。0/0 が続く場合は MinNoise を +2、それでもダメなら DetectSNR を −0.5。
          </div>
        </Section>

        <Section id="ogn-binary-url" heading="OGNバイナリURL">
          <p className="text-sm" style={{ color: "var(--color-text-secondary)" }}>
            <strong>OGNBINARYURL</strong> — OGNバイナリのダウンロード元URL。日本向けは <code>?version=japan</code> を付与。再インストール時に使用。
          </p>
        </Section>

        <Section id="ogn-actions" heading="アクションボタン">
          <ul className="list-disc ml-5 space-y-1 text-sm" style={{ color: "var(--color-text-secondary)" }}>
            <li><strong>設定を保存して受信機を再起動</strong> — 設定変更を保存＋rtlsdr-ogn再起動</li>
            <li><strong>受信機のみ再起動</strong> — 設定は変更せずrtlsdr-ognだけ再起動</li>
          </ul>
        </Section>
      </Card>

      {/* ===== 5. 機体情報画面 ===== */}
      <Card id="manual-aircraft-db" title="5. 機体情報画面">
        <p className="text-sm mb-2" style={{ color: "var(--color-text-secondary)" }}>
          FLARMデバイスID（24bit hex）ごとに機体情報をデータベース管理。マップやフライトログでの表示に使用されます。
        </p>

        <Section id="aircraft-db-fields" heading="保存項目">
          <ul className="list-disc ml-5 space-y-1 text-sm" style={{ color: "var(--color-text-secondary)" }}>
            <li><strong>Device ID</strong> — FLARMの24bit ID（例: <code>DD1234</code>）</li>
            <li><strong>登録番号</strong> — JA番号など（例: <code>JA1234</code>）</li>
            <li><strong>コンテスト番号</strong> — CN（例: <code>AA</code>）</li>
            <li><strong>パイロット名</strong> — 操縦者名</li>
            <li><strong>機種</strong> — 機種名（例: ASW27）</li>
            <li><strong>航空機タイプ</strong> — グライダー / 曳航機 / 動力機 / ヘリ / パラ など。マップアイコンに反映</li>
          </ul>
        </Section>

        <Section id="aircraft-db-ops" heading="操作">
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
  { svg: `<svg width="24" height="24" viewBox="-15 -15 30 30"><path d="M0,-11 Q0.6,-9 1.05,-6 L0.9,-3.5 Q1,-1 0.85,1 L0.6,5.5 Q0.3,8.5 0,10.5 Q-0.3,8.5 -0.6,5.5 L-0.85,1 Q-1,-1 -0.9,-3.5 L-1.05,-6 Q-0.6,-9 0,-11Z" fill="#4caf50" stroke="rgba(0,0,0,.5)" stroke-width=".6"/><path d="M0.8,-2.2 L15,-2.2 L14.5,-1.5 L0.8,0.2Z" fill="#4caf50" stroke="rgba(0,0,0,.5)" stroke-width=".6"/><path d="M-0.8,-2.2 L-15,-2.2 L-14.5,-1.5 L-0.8,0.2Z" fill="#4caf50" stroke="rgba(0,0,0,.5)" stroke-width=".6"/><path d="M0.5,7.5 L5.5,9 L5.5,9.5 L0.5,9.5Z" fill="#4caf50" stroke="rgba(0,0,0,.5)" stroke-width=".6"/><path d="M-0.5,7.5 L-5.5,9 L-5.5,9.5 L-0.5,9.5Z" fill="#4caf50" stroke="rgba(0,0,0,.5)" stroke-width=".6"/></svg>`, label: "グライダー / モーターグライダー", desc: "離着陸時刻と離脱高度の自動検知対象" },
  { svg: `<svg width="24" height="24" viewBox="-15 -15 30 30"><path d="M0.35,-9.41 L2.89,-9.06 L0.98,-8.77 L0.93,-5.7 L12.16,-5.59 L13.2,-4.49 L13.2,-3.56 L12.68,-2.63 L11.06,-1.77 L0.75,-1.65 L0.23,4.26 L2.78,5.12 L3.42,5.93 L3.42,6.51 L2.72,7.15 L1.33,7.44 L0.35,6.8 L0.06,9.81 L-0.35,6.8 L-0.98,7.38 L-3.18,6.92 L-3.53,5.99 L-2.95,5.18 L-0.41,4.31 L-0.98,-1.71 L-11.29,-1.88 L-12.97,-3.1 L-13.2,-4.49 L-12.68,-5.41 L-11.58,-5.76 L-1.04,-5.76 L-1.04,-8.83 L-3.13,-9.18 L-0.41,-9.41 L-0.06,-9.81 Z" fill="#4caf50" stroke="rgba(0,0,0,.5)" stroke-width=".6" stroke-linejoin="round"/></svg>`, label: "曳航機", desc: "離着陸時刻と離脱高度の自動検知対象" },
  { svg: `<svg width="24" height="24" viewBox="-15 -15 30 30"><path d="M-0.02,-10.34 L0.68,-9.59 L3.07,-9.21 L0.73,-9.12 L1.29,-8.75 L1.66,-5.51 L3.92,-4.71 L7.85,-4.71 L13.2,-4.1 L13.2,-1.66 L7.9,0.02 L1.66,-0.02 L0.49,7.85 L0.87,6.96 L4.67,7.06 L4.9,7.43 L4.71,9.5 L3.02,9.54 L2.6,9.92 L0.63,9.87 L0.3,9.45 L0.3,8.7 L0.02,10.34 L-0.26,8.79 L-0.3,9.68 L-0.68,9.92 L-2.51,9.92 L-3.07,9.5 L-4.71,9.45 L-4.71,7.1 L-0.59,7.1 L-1.52,0.07 L-7.67,0.02 L-13.01,-1.57 L-13.2,-4.06 L-8.04,-4.71 L-3.87,-4.71 L-1.62,-5.51 L-1.24,-8.79 L-0.59,-9.12 L-2.88,-9.21 L-0.59,-9.59 Z" fill="#4caf50" stroke="rgba(0,0,0,.5)" stroke-width=".6" stroke-linejoin="round"/></svg>`, label: "動力機", desc: "プロペラ機" },
  { svg: `<svg width="24" height="24" viewBox="-15 -15 30 30"><path d="M-0.21,-9.1 L0.41,-9 L1.09,-8.07 L1.71,-6.41 L1.97,-4.64 L10.01,-8.79 L10.58,-8.58 L10.63,-8.27 L10.06,-7.81 L2.02,-3.55 L2.02,-2.1 L1.87,-0.91 L5.71,7.34 L5.81,8.12 L5.34,8.32 L4.98,7.96 L1.45,0.54 L0.99,2.26 L0.67,7.39 L3.58,7.91 L3.58,8.58 L0.67,8.58 L0.52,11.23 L0.31,11.38 L0.21,13.2 L0.1,11.38 L-0.36,11.02 L-0.52,12.47 L-0.57,9.67 L-0.41,10.76 L-0.16,10.76 L-0.36,8.64 L-3.16,8.64 L-3.22,7.96 L-0.36,7.55 L-0.57,4.9 L-0.62,3.81 L-0.88,1.79 L-1.24,0.65 L-1.66,-0.91 L-10.06,3.24 L-10.63,3.09 L-10.53,2.46 L-2.59,-1.43 L-1.82,-1.89 L-1.92,-2.36 L-1.92,-2.88 L-2.02,-3.09 L-1.97,-3.81 L-1.87,-4.69 L-6.07,-12.73 L-5.91,-13.1 L-5.34,-13.2 L-1.66,-6.3 L-0.88,-8.32 L-0.26,-9.05 Z" fill="#4caf50" stroke="rgba(0,0,0,.5)" stroke-width=".6" stroke-linejoin="round"/></svg>`, label: "ヘリコプター", desc: "" },
  { svg: `<svg width="24" height="24" viewBox="-15 -15 30 30"><path d="M2.44,-5.28 C4.1,-5.2 6.3,-5.0 7.57,-4.87 C8.8,-4.7 9.4,-4.5 10.08,-4.31 C10.8,-4.1 11.5,-3.7 11.94,-3.47 C12.4,-3.2 12.5,-3.1 12.73,-2.77 C12.9,-2.5 13.2,-2.5 13.2,-1.65 C13.2,-0.8 13.7,1.5 12.78,2.35 C11.9,3.2 9.5,3.1 7.89,3.38 C6.3,3.7 4.3,3.7 2.96,3.98 C1.7,4.3 1.1,5.3 0.07,5.28 C-0.9,5.3 -1.7,4.3 -3,3.98 C-4.3,3.7 -6.4,3.7 -8.03,3.38 C-9.7,3.1 -11.9,3.2 -12.78,2.35 C-13.6,1.5 -13.2,-0.7 -13.2,-1.56 C-13.2,-2.4 -13.1,-2.2 -12.87,-2.54 C-12.7,-2.9 -12.5,-3.1 -11.99,-3.42 C-11.5,-3.7 -10.7,-4.1 -10.03,-4.31 C-9.3,-4.5 -9.1,-4.7 -7.8,-4.82 C-6.5,-5.0 -4.1,-5.2 -2.35,-5.28 C-0.6,-5.4 0.8,-5.3 2.44,-5.28 Z" fill="#4caf50" stroke="rgba(0,0,0,.5)" stroke-width=".6" stroke-linejoin="round"/></svg>`, label: "パラグライダー", desc: "" },
  { svg: `<svg width="24" height="24" viewBox="-15 -15 30 30"><path d="M0.05,-4.51 L-11.02,0.28 L-11.99,0.98 C-12.4,1.3 -13.0,2.1 -13.2,2.46 C-13.4,2.8 -13.3,2.8 -13.2,2.93 C-13.1,3.1 -12.9,3.3 -12.74,3.44 C-12.5,3.6 -12.5,3.7 -12.04,3.72 C-11.6,3.8 -11.5,4.0 -10.04,3.67 L-3.35,1.77 L-0.51,1.35 L-0.14,2.84 L-0.05,4.51 L0.09,2.84 L0.51,1.35 L7.62,3.3 L8.83,3.72 L10.83,4.28 C11.4,4.4 12.1,4.3 12.5,4.14 C12.9,4.0 13.1,3.7 13.2,3.44 C13.3,3.2 13.1,2.9 12.83,2.56 C12.6,2.2 12.3,1.8 11.81,1.39 L9.95,0.19 L0.09,-4.51 L0.05,-4.51 Z" fill="#4caf50" stroke="rgba(0,0,0,.5)" stroke-width=".6" stroke-linejoin="round"/></svg>`, label: "ハンググライダー", desc: "" },
  { svg: `<svg width="24" height="24" viewBox="-15 -15 30 30"><circle cx="0" cy="-6" r="3" fill="#4caf50" stroke="rgba(0,0,0,.4)" stroke-width=".5"/><line x1="0" y1="-3" x2="0" y2="5" stroke="#4caf50" stroke-width="2" stroke-linecap="round"/><line x1="-7" y1="-1" x2="7" y2="-1" stroke="#4caf50" stroke-width="1.5" stroke-linecap="round"/><line x1="0" y1="5" x2="-5" y2="11" stroke="#4caf50" stroke-width="1.5" stroke-linecap="round"/><line x1="0" y1="5" x2="5" y2="11" stroke="#4caf50" stroke-width="1.5" stroke-linecap="round"/></svg>`, label: "スカイダイバー", desc: "" },
  { svg: `<svg width="24" height="24" viewBox="-15 -15 30 30"><ellipse cx="0" cy="-3" rx="8" ry="10" fill="#4caf50" stroke="rgba(0,0,0,.4)" stroke-width=".5"/><line x1="-3" y1="7" x2="-2" y2="10" stroke="#4caf50" stroke-width=".7"/><line x1="3" y1="7" x2="2" y2="10" stroke="#4caf50" stroke-width=".7"/><rect x="-3" y="10" width="6" height="4" rx="1" fill="#4caf50" stroke="rgba(0,0,0,.4)" stroke-width=".4"/></svg>`, label: "バルーン", desc: "" },
  { svg: `<svg width="24" height="24" viewBox="-15 -15 30 30"><path d="M-0.59,-11.66 L-0.81,-4.07 L-5.98,-6.98 L-5.44,-8.27 L-5.39,-9.94 L-5.98,-11.4 L-7.33,-12.63 L-8.73,-13.12 L-10.34,-13.01 L-11.69,-12.31 L-12.77,-11.02 L-13.15,-9.89 L-13.09,-8.27 L-11.75,-6.17 L-9.75,-5.31 L-8.46,-5.36 L-6.95,-5.95 L-2.37,-2.51 L-2.48,2.61 L-6.68,6.22 L-8.08,5.47 L-10.02,5.36 L-11.75,6.17 L-12.93,7.79 L-13.2,9.4 L-12.72,11.13 L-11.64,12.36 L-9.86,13.12 L-7.87,12.9 L-6.14,11.61 L-5.33,9.46 L-5.76,7.35 L-0.97,3.74 L1.51,3.8 L5.98,6.98 L5.39,8.65 L5.5,10.32 L6.2,11.66 L7.76,12.85 L10.34,13.01 L11.8,12.26 L12.66,11.23 L13.15,9.99 L13.15,8.43 L12.55,7.03 L11.75,6.17 L9.7,5.31 L8.51,5.36 L6.95,5.95 L2.86,2.61 L2.86,-2.45 L7.33,-5.74 L9.81,-5.31 L12.12,-6.49 L13.2,-8.76 L13.04,-10.43 L12.23,-11.83 L11.31,-12.58 L9.81,-13.12 L7.33,-12.63 L6.09,-11.5 L5.39,-9.78 L5.5,-8.16 L6.2,-6.6 L1.24,-4.07 L1.08,-11.66 C0.8,-12.9 -0.3,-12.9 -0.59,-11.66 Z" fill="#4caf50" stroke="rgba(0,0,0,.5)" stroke-width=".6" stroke-linejoin="round"/></svg>`, label: "UAV / ドローン", desc: "" },
  { svg: `<svg width="24" height="24" viewBox="-12 -12 24 24"><path d="M0,-10 L1.5,-4 L8,-1 L8,0.5 L1.5,1.5 L1,6 L3.5,7.5 L3.5,8.5 L-3.5,8.5 L-3.5,7.5 L-1,6 L-1.5,1.5 L-8,0.5 L-8,-1 L-1.5,-4Z" fill="#1565c0" stroke="rgba(255,255,255,.5)" stroke-width=".5"/></svg>`, label: "ADS-B（青） / Mode-S/C（黒）", desc: "tar1090経由のADS-B機体" },
  { svg: `<svg width="24" height="24" viewBox="-11 -11 22 22"><path d="M0,-9 L4,8 L0,5 L-4,8 Z" fill="#00b894" stroke="rgba(0,0,0,.5)" stroke-width="0.7"/><line x1="-3" y1="-2" x2="3" y2="-2" stroke="#00b894" stroke-width="1.2"/><line x1="-5" y1="-5" x2="5" y2="-5" stroke="#00b894" stroke-width="1.2"/></svg>`, label: "OGN受信機（アンテナ）", desc: "OGN設定の緯度経度に表示。緑=稼働中、グレー=停止" },
];

function ReleaseNotesContent() {
  return (
    <>
      {/* v1.1.23 */}
      <div className="flex items-center gap-3 mb-2">
        <span className="text-base font-bold" style={{ color: "var(--color-accent)" }}>v1.1.23</span>
        <span className="text-sm" style={{ color: "var(--color-text-secondary)" }}>2026-05-04</span>
        <span className="px-2 py-0.5 rounded text-xs font-medium" style={{ background: "var(--color-accent-light)", color: "var(--color-accent)" }}>最新</span>
      </div>

      <Card title="OGN受信機 AGC設定をWeb UIから調整可能に">
        <ul className="list-disc ml-5 space-y-1 text-sm" style={{ color: "var(--color-text-secondary)" }}>
          <li>OGN設定タブに「AGC（自動利得制御）・デコーダ設定」セクションを追加。Initial Gain / MinNoise / MaxNoise / DetectSNR をブラウザから編集可能に（従来はSSHで <code>/boot/rtlsdr-ogn.conf</code> を直編集する必要があった）</li>
          <li>標準 / 弱信号 / 高ノイズ環境向けの3つのプリセットを用意（ボタン1クリックで適切な値をフォームに反映）</li>
          <li>ステータスタブのOGN受信機セクションに「受信機体数（直近1分・1時間）」「ポジション受信数」「DetectSNR」を追加。設定変更の効果がリアルタイムに分かるように</li>
          <li>ヘルプに「AGC（自動利得制御）」セクションを追加。動作ロジック、各パラメータの意味、環境別調整ガイドを掲載</li>
          <li>日本ではGSMが2012年に停波済みでキャリブレーション不可能なため、GSM中心周波数 / GSMゲインの設定UIと <code>/boot/rtlsdr-ogn.conf</code> の GSM セクションをまるごと削除</li>
        </ul>
      </Card>

      {/* v1.1.22 */}
      <div className="flex items-center gap-3 mb-2 mt-6">
        <span className="text-base font-bold" style={{ color: "var(--color-accent)" }}>v1.1.22</span>
        <span className="text-sm" style={{ color: "var(--color-text-secondary)" }}>2026-05-04</span>
      </div>

      <Card title="弱信号環境向けに OGN 受信感度を強化">
        <ul className="list-disc ml-5 space-y-1 text-sm" style={{ color: "var(--color-text-secondary)" }}>
          <li>FLARM受信用のAGCを再調整（MinNoise 2.0→5.0 / MaxNoise 6.0→10.0）。AGCを高gain側（約37 dB）まで踏み込ませることで、遠距離・低出力FLARMの受信を改善</li>
          <li>デコード閾値（DetectSNR）を 6.0 → 3.0 に下げ、ノイズフロアぎりぎりの弱信号もパケット化対象に</li>
          <li>滝川滑空場フィールドテストで、変更前0機/分→変更後2機/分・119ポジション/分の安定受信を確認</li>
          <li>新規インストール（feeldscope-install.sh）にも反映済み</li>
        </ul>
      </Card>

      {/* v1.1.21 */}
      <div className="flex items-center gap-3 mb-2 mt-6">
        <span className="text-base font-bold" style={{ color: "var(--color-accent)" }}>v1.1.21</span>
        <span className="text-sm" style={{ color: "var(--color-text-secondary)" }}>2026-05-04</span>
      </div>

      <Card title="RTL-SDR Blog V4 対応 + 日本FLARM最適化">
        <ul className="list-disc ml-5 space-y-1 text-sm" style={{ color: "var(--color-text-secondary)" }}>
          <li>OGN公式イメージ同梱の librtlsdr 0.6.0 が RTL-SDR Blog V4 を扱えず922MHz帯で受信不能になる問題を解消（rtl-sdr-blog 公式フォークドライバを自動インストール）</li>
          <li>/boot/rtlsdr-ogn.conf を日本FLARM最適化テンプレートで生成（FreqPlan=7=Japan、922.4 MHz中心、3チャネル対応）</li>
          <li>setup-guide.html に V3/V4 注意書きを追加</li>
        </ul>
      </Card>

      {/* v1.1.20 */}
      <div className="flex items-center gap-3 mb-2 mt-6">
        <span className="text-base font-bold" style={{ color: "var(--color-accent)" }}>v1.1.20</span>
        <span className="text-sm" style={{ color: "var(--color-text-secondary)" }}>2026-04-30</span>
      </div>

      <Card title="ADS-B 受信ステータスの誤表示を修正（OFF/ON 両方向）">
        <ul className="list-disc ml-5 space-y-1 text-sm" style={{ color: "var(--color-text-secondary)" }}>
          <li>OFF なのに「正常受信中」: adsb-poller 停止時に retained MQTT <code>adsb_status</code> をクリアするように修正</li>
          <li>ON なのに「停止中」: webapp と adsb-poller でレシーバーID（MQTTトピック宛先）が一致しないと retained 取得失敗。ON 時に webapp 側で検出した receiver-id を <code>--receiver-id</code> として明示的に渡すよう修正</li>
          <li>サービス起動直後など retained 未到着の状態を「停止中」と誤判定しないよう、Status API が <code>service_active</code> を別フィールドで返し、UI で「起動中（データ待ち）」を新表示</li>
        </ul>
      </Card>

      {/* v1.1.18 */}
      <div className="flex items-center gap-3 mb-2 mt-6">
        <span className="text-base font-bold" style={{ color: "var(--color-accent)" }}>v1.1.18</span>
        <span className="text-sm" style={{ color: "var(--color-text-secondary)" }}>2026-04-30</span>
      </div>

      <Card title="ハンググライダー・ドローンのアイコンを刷新">
        <ul className="list-disc ml-5 space-y-1 text-sm" style={{ color: "var(--color-text-secondary)" }}>
          <li>ハンググライダー：実機シルエットをトレースした翼形状に更新</li>
          <li>ドローン：6ローター機体を実機形状でトレース、機首側に向き表現を追加</li>
          <li>マニュアル（凡例）も同じパスで統一</li>
        </ul>
      </Card>

      {/* v1.1.16 */}
      <div className="flex items-center gap-3 mb-2 mt-6">
        <span className="text-base font-bold" style={{ color: "var(--color-accent)" }}>v1.1.16</span>
        <span className="text-sm" style={{ color: "var(--color-text-secondary)" }}>2026-04-27</span>
      </div>

      <Card title="機種別アイコンを刷新">
        <ul className="list-disc ml-5 space-y-1 text-sm" style={{ color: "var(--color-text-secondary)" }}>
          <li>滑空機・曳航機・動力機・ヘリコプター・パラグライダーの全アイコンを実機画像からトレースしたSVGパスに更新</li>
          <li>滑空機は高アスペクト比翼（AR≈20）、ベジェ曲線胴体で実機形状を再現</li>
          <li>その他機種もIconMakerツールで実機シルエットをトレースして作成</li>
        </ul>
      </Card>

      {/* v1.1.15 */}
      <div className="flex items-center gap-3 mb-2 mt-6">
        <span className="text-base font-bold" style={{ color: "var(--color-accent)" }}>v1.1.15</span>
        <span className="text-sm" style={{ color: "var(--color-text-secondary)" }}>2026-04-18</span>
      </div>

      <Card title="マップタイルが読み込まれない不具合を修正">
        <ul className="list-disc ml-5 space-y-1 text-sm" style={{ color: "var(--color-text-secondary)" }}>
          <li>v1.1.14 で地図初期化を unitsLoaded 待機にした副作用で、タイルレイヤ追加 / OGN受信機マーカー の副効果がマップ生成前に1回だけ実行され、地図が白いまま表示される問題を修正</li>
          <li>内部的に <code>mapReady</code> state を導入し、マップインスタンス生成完了後にタイル・マーカー系の副効果を再実行するよう依存関係を修正</li>
        </ul>
      </Card>

      {/* v1.1.14 */}
      <div className="flex items-center gap-3 mb-2 mt-6">
        <span className="text-base font-bold" style={{ color: "var(--color-accent)" }}>v1.1.14</span>
        <span className="text-sm" style={{ color: "var(--color-text-secondary)" }}>2026-04-18</span>
      </div>

      <Card title="マップ初期表示を保存済みHOMEビューに">
        <ul className="list-disc ml-5 space-y-1 text-sm" style={{ color: "var(--color-text-secondary)" }}>
          <li>ハードリロード時に地図の中心が滑空場設定値に戻ってしまう問題を修正</li>
          <li>HOMEビューが保存されていれば、ハードリロード時の初期表示もそのHOMEビューを使用</li>
          <li>滑空場設定がサーバから読み込まれるのを待ってから地図を初期化する（HOMEビュー未保存時の滑空場中心表示の精度向上）</li>
        </ul>
      </Card>

      {/* v1.1.13 */}
      <div className="flex items-center gap-3 mb-2 mt-6">
        <span className="text-base font-bold" style={{ color: "var(--color-accent)" }}>v1.1.13</span>
        <span className="text-sm" style={{ color: "var(--color-text-secondary)" }}>2026-04-18</span>
      </div>

      <Card title="滑空場設定の不整合を修正">
        <ul className="list-disc ml-5 space-y-1 text-sm" style={{ color: "var(--color-text-secondary)" }}>
          <li>サーバ側 <code>airfield-config.json</code> が欠損している場合にブラウザlocalStorageの古い滑空場座標が表示され続ける問題を修正</li>
          <li>サーバは常にデフォルト値（関宿滑空場）を返し、nullを返さないように統一</li>
          <li>滑空場の連続編集時に複数POSTが競合してサーバ最終値が不定になる問題をデバウンス（500ms）+ AbortController で解消</li>
        </ul>
      </Card>

      {/* v1.1.12 */}
      <div className="flex items-center gap-3 mb-2 mt-6">
        <span className="text-base font-bold" style={{ color: "var(--color-accent)" }}>v1.1.12</span>
        <span className="text-sm" style={{ color: "var(--color-text-secondary)" }}>2026-04-18</span>
      </div>

      <Card title="ADS-B状態不整合の修正">
        <ul className="list-disc ml-5 space-y-1 text-sm" style={{ color: "var(--color-text-secondary)" }}>
          <li>GUIが「有効」表示のまま実態は停止中になるケースを解消</li>
          <li>ADS-B設定はサーバ側ファイル（<code>adsb-config.json</code>）を常に真とし、ブラウザlocalStorageで上書きしない</li>
          <li>無効化時にファイルを削除せず <code>enabled: false</code> で保存する方式に変更</li>
          <li>Settingsページ訪問時の自動start/stop副作用を撤廃。状態変化はチェックボックス操作時のみ</li>
          <li>DEFAULT_ADSB.url を空文字列に変更（placeholder属性でサンプル表示）</li>
        </ul>
      </Card>

      {/* v1.1.11 */}
      <div className="flex items-center gap-3 mb-2 mt-6">
        <span className="text-base font-bold" style={{ color: "var(--color-accent)" }}>v1.1.11</span>
        <span className="text-sm" style={{ color: "var(--color-text-secondary)" }}>2026-04-18</span>
      </div>

      <Card title="フレッシュインストール対応">
        <ul className="list-disc ml-5 space-y-1 text-sm" style={{ color: "var(--color-text-secondary)" }}>
          <li><code>feeldscope-install.sh</code>: gitignore対象の <code>aircraft-db.json</code> / <code>adsb-config.json</code> が無い場合は空のデフォルトを自動生成するよう修正</li>
          <li>git cloneからのフレッシュインストールで Step 4 が失敗する問題を解消</li>
        </ul>
      </Card>

      {/* v1.1.10 */}
      <div className="flex items-center gap-3 mb-2 mt-6">
        <span className="text-base font-bold" style={{ color: "var(--color-accent)" }}>v1.1.10</span>
        <span className="text-sm" style={{ color: "var(--color-text-secondary)" }}>2026-04-18</span>
      </div>

      <Card title="ヘルプウィンドウを別ウィンドウ化">
        <ul className="list-disc ml-5 space-y-1 text-sm" style={{ color: "var(--color-text-secondary)" }}>
          <li>マニュアル / リリースノート / バージョン / サポートをメイン画面に重なるモーダルから独立したブラウザウィンドウへ変更</li>
          <li>マニュアルを読みながらメイン画面を操作可能に</li>
          <li>マニュアルヘルプアイコン（?）も同じ別ウィンドウを開く方式に統一（既存ウィンドウは再利用）</li>
        </ul>
      </Card>

      {/* v1.1.9 */}
      <div className="flex items-center gap-3 mb-2 mt-6">
        <span className="text-base font-bold" style={{ color: "var(--color-accent)" }}>v1.1.9</span>
        <span className="text-sm" style={{ color: "var(--color-text-secondary)" }}>2026-04-18</span>
      </div>

      <Card title="マニュアルヘルプアイコンを追加">
        <ul className="list-disc ml-5 space-y-1 text-sm" style={{ color: "var(--color-text-secondary)" }}>
          <li>マニュアルに説明が載っているGUIの横に小さな「?」アイコンを配置</li>
          <li>クリックでヘルプ画面のマニュアルが開き、該当セクションへ自動スクロール＋ハイライト</li>
          <li>マップ（HOMEボタン / 警告 / 上空 / 凡例 / フライトログ）、ステータス全カード、設定全カード、OGN設定全カード、機体情報画面に対応</li>
        </ul>
      </Card>

      {/* v1.1.8 */}
      <div className="flex items-center gap-3 mb-2 mt-6">
        <span className="text-base font-bold" style={{ color: "var(--color-accent)" }}>v1.1.8</span>
        <span className="text-sm" style={{ color: "var(--color-text-secondary)" }}>2026-04-18</span>
      </div>

      <Card title="マニュアル整備（v1.1.7の画面移動を反映）">
        <ul className="list-disc ml-5 space-y-1 text-sm" style={{ color: "var(--color-text-secondary)" }}>
          <li>マニュアル/セットアップガイドから「設定タブ 3-8 システムステータス」節を削除</li>
          <li>ステータスタブ説明に「システムステータス（Mosquitto / ogn-mqtt / igc-simulator / adsb-poller）」を明記</li>
          <li>設定タブ内のセクション番号を繰上げ（3-9〜3-11 → 3-8〜3-10）</li>
        </ul>
      </Card>

      {/* v1.1.7 */}
      <div className="flex items-center gap-3 mb-2 mt-6">
        <span className="text-base font-bold" style={{ color: "var(--color-accent)" }}>v1.1.7</span>
        <span className="text-sm" style={{ color: "var(--color-text-secondary)" }}>2026-04-17</span>
      </div>

      <Card title="システムステータスをステータスタブへ移動">
        <ul className="list-disc ml-5 space-y-1 text-sm" style={{ color: "var(--color-text-secondary)" }}>
          <li>サービス稼働表示（Mosquitto / ogn-mqtt / igc-simulator / adsb-poller）を設定タブからステータスタブへ集約</li>
          <li>設定タブはシステム設定に専念、ステータスタブはすべての稼働情報を一画面で閲覧可能に</li>
        </ul>
      </Card>

      {/* v1.1.6 */}
      <div className="flex items-center gap-3 mb-2 mt-6">
        <span className="text-base font-bold" style={{ color: "var(--color-accent)" }}>v1.1.6</span>
        <span className="text-sm" style={{ color: "var(--color-text-secondary)" }}>2026-04-17</span>
      </div>

      <Card title="sudo -n 対応（VPS環境でのsudo修正）">
        <ul className="list-disc ml-5 space-y-1 text-sm" style={{ color: "var(--color-text-secondary)" }}>
          <li>APIからのsudo呼び出しを全て sudo -n に変更(PTY不要な非対話モード)</li>
          <li>VPS環境(use_ptyデフォルト設定)での権限エラーを解消</li>
        </ul>
      </Card>

      {/* v1.1.5 */}
      <div className="flex items-center gap-3 mb-2 mt-6">
        <span className="text-base font-bold" style={{ color: "var(--color-accent)" }}>v1.1.5</span>
        <span className="text-sm" style={{ color: "var(--color-text-secondary)" }}>2026-04-17</span>
      </div>

      <Card title="アップデートのプログレスバー修正">
        <ul className="list-disc ml-5 space-y-1 text-sm" style={{ color: "var(--color-text-secondary)" }}>
          <li>アップデート中にWebアプリが停止していたためプログレスバーが消える不具合を修正</li>
          <li>ビルド完了まではWebアプリを稼働させ続け、最後のサービス再起動時のみ接続が切れる動作に変更</li>
        </ul>
      </Card>

      {/* v1.1.4 */}
      <div className="flex items-center gap-3 mb-2 mt-6">
        <span className="text-base font-bold" style={{ color: "var(--color-accent)" }}>v1.1.4</span>
        <span className="text-sm" style={{ color: "var(--color-text-secondary)" }}>2026-04-17</span>
      </div>

      <Card title="サポート機能追加">
        <ul className="list-disc ml-5 space-y-1 text-sm" style={{ color: "var(--color-text-secondary)" }}>
          <li>ヘルプメニューに「サポート」タブを追加</li>
          <li>不具合内容の入力フォームと診断ZIPダウンロード機能を実装</li>
          <li>ZIP内容: システム情報・各サービスのsystemdログ・フライトログ・ブラウザ設定</li>
          <li>OverlayFS ON状態でもブラウザメモリ上でZIPを生成・ダウンロード可能</li>
        </ul>
      </Card>

      {/* v1.1.3 */}
      <div className="flex items-center gap-3 mb-2 mt-6">
        <span className="text-base font-bold" style={{ color: "var(--color-accent)" }}>v1.1.3</span>
        <span className="text-sm" style={{ color: "var(--color-text-secondary)" }}>2026-04-14</span>
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
          <li>システムステータス（Mosquitto / ogn-mqtt / igc-simulator / adsb-poller の稼働状態）</li>
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
          <InfoRow label="リリース日" value="2026-04-18 (v1.1.15)" />
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

      function settled(r: PromiseSettledResult<unknown>) {
        return r.status === "fulfilled" ? r.value : { __error: String((r as PromiseRejectedResult).reason) };
      }
      folder.file("system-info.json", JSON.stringify(settled(systemRes), null, 2));
      folder.file("realtime-status.json", JSON.stringify(settled(statusRes), null, 2));
      folder.file("ogn-receiver.json", JSON.stringify(settled(ognRes), null, 2));
      folder.file("flight-log.json", JSON.stringify(settled(flightRes), null, 2));

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

function Card({ title, children, id }: { title: string; children: React.ReactNode; id?: string }) {
  return (
    <section
      data-help-id={id}
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

function Section({ heading, children, id }: { heading: string; children: React.ReactNode; id?: string }) {
  return (
    <div data-help-id={id}>
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
