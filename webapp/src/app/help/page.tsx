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
            <li><strong>機体クリック</strong> — その機体を選択し、<strong>右上に詳細パネル</strong>と<strong>「このフライト」の航跡（青の実線）</strong>を表示。<strong>地図の余白クリックで自動的に閉じます</strong></li>
          </ul>
        </Section>
        <Section id="map-home-save" heading="HOMEボタン・保存ボタン（マップ右上）">
          <ul className="list-disc ml-5 space-y-1 text-sm" style={{ color: "var(--color-text-secondary)" }}>
            <li><strong>HOME</strong> — 保存済みの「HOMEビュー」（地図中心位置・ズーム）に瞬時に戻ります。未保存時は滑空場設定の位置を表示</li>
            <li><strong>保存</strong> — 現在表示中の地図の中心位置とズームを「HOMEビュー」として保存（ブラウザに保存）。次回起動時もこの位置から開始</li>
          </ul>
        </Section>
        <Section id="map-sidebar" heading="サイドバー（右）">
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
            <li><span style={{ color: "#4caf50", fontWeight: 600 }}>緑</span> — 通常飛行中（Open OGN で補った圏外の機体も同じ緑で、見た目では区別しません。ただし航跡は描きません）</li>
            <li><span style={{ color: "#ff9800", fontWeight: 600 }}>橙</span> — 低高度・着陸進入中（着陸確定後に緑へ復帰）</li>
            <li><span style={{ color: "#f44336", fontWeight: 600 }}>赤・点滅</span> — パス不足（滑空場に安全に帰還できない高度）</li>
            <li><span style={{ color: "#1565c0", fontWeight: 600 }}>青</span> — ADS-B受信機体（ローカル受信機／Open ADS-B＝adsb.lol の両方）</li>
            <li><span style={{ color: "#222", fontWeight: 600 }}>黒</span> — Mode-S/Mode-C機体</li>
            <li><span style={{ color: "#777", fontWeight: 600 }}>灰「?」</span> — 匿名機（ランダムID／EPRA。追跡不可のため位置のみを集約表示）</li>
          </ul>
        </Section>
        <Section id="map-icon-labels" heading="機体アイコンのラベル（機番・高度・速度）">
          <ul className="list-disc ml-5 space-y-1 text-sm" style={{ color: "var(--color-text-secondary)" }}>
            <li>各機体アイコンの<strong>上に表示名</strong>（設定「表示名」に応じて 機番／コンテストナンバー／パイロット）、<strong>下に高度・速度</strong>を常時表示します。</li>
            <li>高度・速度の単位は設定「表示単位」に従います（m／ft、km/h／kt）。ラベルは縁取り付きで、ライト／ダークどちらのテーマでも読めます。</li>
            <li>アイコンは検知ごとに瞬間移動せず、<strong>位置も機首の向きも滑らかにアニメーション</strong>します。ブラウザを背後にして戻したときに溜まった動きを一気に再生することはありません（受信ギャップ時は即時表示）。</li>
          </ul>
        </Section>
        <Section id="map-aircraft-click" heading="機体クリック（このフライトの航跡・詳細パネル）">
          <ul className="list-disc ml-5 space-y-1 text-sm" style={{ color: "var(--color-text-secondary)" }}>
            <li>機体アイコンをクリックすると、<strong>右上に詳細パネル</strong>（機種・登録番号・CN・高度・速度・上昇率・方位・パス等）と、<strong>その機体が「このフライトで飛んだ」航跡（青の実線）</strong>を表示します。</li>
            <li>航跡は飛行中なら伸びていきます（約5秒ごとに追随）。着陸して地上に戻ると約90秒で消え、次のフライトから新しく始まります。</li>
            <li><strong>地図上の機体以外（余白）をクリックすると自動的に閉じます</strong>。パネルの「閉じる」でも閉じられます。</li>
          </ul>
        </Section>
        <Section id="map-range-rings" heading="同心円表示（距離リング）">
          <ul className="list-disc ml-5 space-y-1 text-sm" style={{ color: "var(--color-text-secondary)" }}>
            <li>滑空場を中心に<strong>半径5km・10km・15km・20km・25km・30kmの同心円（点線・距離ラベル付き）</strong>を表示します。機体までの距離の目視把握に使えます。</li>
            <li>既定は表示です。消したい場合は設定 → マップ表示の<strong>「同心円表示」のチェックを外して</strong>ください。</li>
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
            <li><strong>登録番号</strong> — 機体登録番号（機体DB登録があれば表示）。コンテストナンバーが登録されていれば <strong>JA03KH (KH)</strong> のように括弧で併記します</li>
            <li><strong>離陸</strong> — 離陸時刻 HH:MM（手動編集可）。<strong>空欄</strong>は「離陸を観測できなかった」場合（外来機の飛来や、離陸後に FLARM の電源を入れた等）で、着陸を検知した時点で<strong>着陸のみの記録</strong>が作られます</li>
            <li><strong>着陸</strong> — 着陸時刻 HH:MM（飛行中は「飛行中」と表示）。<strong>空欄</strong>は「着陸したが時刻が分からない」場合で、そのまま手で入力できます</li>
            <li>表は新しい飛行に追従して末尾を表示します。上へ遡っている間は追従を止めるので、過去の記録をゆっくり確認できます</li>
            <li><strong>飛行時間</strong> — 自動計算 HH+MM 形式</li>
            <li><strong>離脱高度</strong> — 曳航離脱時の高度（手動編集可）。<strong>※</strong>が付いた値は、その機体自身の離脱を検知できず<strong>曳航機の離脱高度から写したもの</strong>です（手で直すと※は消えます）</li>
            <li><strong>離脱距離</strong> — 離脱時の滑空場からの距離</li>
            <li><strong>🗑 削除ボタン</strong> — その行を削除（確認ダイアログあり）</li>
            <li><strong>テーブル高さ</strong> — マップとの境界をドラッグで変更可能（ブラウザ保存）</li>
          </ul>
          <p className="text-xs mt-2" style={{ color: "var(--color-text-secondary)" }}>
            記録は<strong>サーバのメモリ</strong>と<strong>表示端末のブラウザ（ローカルストレージ）</strong>の両方に保存されます。
            サーバが再起動してメモリ上の記録が消えても、ブラウザに残った当日分から自動的に補完・復元されるため、当日の記録は失われません。
            毎日 <strong>日本時間 AM 5:00</strong> に当日分を自動リセット。複数端末で同じログを参照できます。
          </p>
          <p className="text-xs mt-2" style={{ color: "var(--color-text-secondary)" }}>
            ※本システムは既存の運航に<strong>オーバーレイ表示</strong>する前提のため、サーバがデータベース等に記録を永続保存し続けることはありません。
            保持するのは当日分のみで、翌日（AM 5:00以降）には破棄されます。
            また、当然ながら<strong>サーバ（受信機）が停止している間に発生した離着陸は一切記録されません</strong>。記録対象はサーバ稼働中の時間帯のみです。
          </p>
        </Section>
        <Section id="map-detection-thresholds" heading="自動検知の閾値">
          <ul className="list-disc ml-5 space-y-1 text-sm" style={{ color: "var(--color-text-secondary)" }}>
            <li><strong>離陸検知</strong> — 対地速度が <strong>30 km/h</strong> を超えた瞬間。ただし飛行として記録するのは、そこから<strong>60秒以内に対地20mまで浮いた</strong>ときだけです（地上滑走と区別するため）。記録される離陸時刻は滑走を始めた時刻です</li>
            <li><strong>着陸検知</strong> — 一度 1500ft AGL を超えた機体が、1500ft AGL以下かつ <strong>10 km/h以下</strong> になった瞬間</li>
            <li><strong>離脱検知（グライダー・曳航）</strong> — 対地150m以上で、離陸から100m以上上昇したあと、上昇が止まり、かつ6秒以内に <strong>5 m/s以上</strong> 減速したとき</li>
            <li><strong>離脱検知（グライダー・ウィンチ）</strong> — 離陸から60秒以内に上昇率 <strong>7 m/s</strong> 以上が5秒続いたらウィンチ発航とみなし、そのあと上昇率が <strong>2 m/s</strong> 以下に落ちた瞬間を離脱とします。速度は見ません</li>
            <li><strong>離脱検知（曳航機）</strong> — 対地300m以上で、高度ピークから50m以上の降下</li>
            <li><strong>離脱高度の補完（曳航）</strong> — 曳航機とグライダーが60秒以内に離陸し、水平200m・垂直100m以内で3回以上並んで上がったら曳航ペアとみなします。曳航機の離脱を検知したあと<strong>2分待って</strong>もグライダー側で検知できなければ、曳航機の離脱高度を写します（※印付き）</li>
            <li><strong>ウィンチ発航との区別</strong> — 上昇率が <strong>6 m/s</strong> を超える機体は索で曳かれていないとみなし、曳航ペアに入れません</li>
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

        <Section id="status-open-sources" heading="Open データ源（外部API受信状態）">
          <ul className="list-disc ml-5 space-y-1 text-sm" style={{ color: "var(--color-text-secondary)" }}>
            <li>設定でONにした外部データ源が<strong>実際に受信できているか</strong>を表示します。「設定したつもりでも受信できていない」状態の発見用です。</li>
            <li><strong>Open ADS-B（adsb.lol）</strong> — 最終取得成功の時刻と表示機数。取得できていない場合は<strong>直近の失敗理由</strong>（接続タイムアウト・レート制限等）を表示します。</li>
            <li><strong>Open OGN（aprs.glidernet.org）</strong> — APRS-IS への接続状態と受信機数。マップを表示している間に自動接続されます（この画面からは接続を開始しません）。</li>
            <li>OFFのデータ源はグレーで「無効」と表示します。</li>
          </ul>
        </Section>
        <Section id="status-services" heading="サービス稼働状況">
          <table className="w-full text-sm" style={{ borderCollapse: "collapse" }}><tbody>
            <ManualRow label="mosquitto" desc="MQTTブローカー（FEELDSCOPE全体の通信ハブ）" />
            <ManualRow label="ogn-mqtt" desc="OGN受信機からのデータをMQTTに変換して配信" />
            <ManualRow label="igc-simulator" desc="IGCファイル履歴再生サービス（リアルタイム再生時は停止）" />
            <ManualRow label="adsb-poller" desc="tar1090からADS-Bデータを定期取得してMQTTに配信" />
            <ManualRow label="feeldscope-webapp" desc="本Webアプリケーション" />
            <ManualRow label="avahi-daemon" desc="mDNS（&lt;hostname&gt;.local 名前解決）デーモン" />
            <ManualRow label="rtlsdr-ogn (init.d)" desc="OGNのRF受信・デコードプロセス（init.d管理）。応答が無くなると2分ごとの見回りが自動で起動し直します" />
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
            <li><strong>IGC ファイルをアップロード</strong>ボタン — 拡張子 .igc のファイルをサーバに保存。<strong>1ファイル10MBまで</strong></li>
            <li><strong>削除</strong>ボタン — 各ファイルを削除(確認ダイアログ)</li>
            <li>アップロードと削除には<strong>管理者ログインが必要</strong>です。一覧の表示はログイン不要です</li>
          </ul>
          <p className="text-xs mt-2" style={{ color: "var(--color-text-secondary)" }}>
            OLC（onlinecontest.org）等からダウンロードしたIGCを使用可能。
            記録時刻を現在時刻にずらして再生されるため、過去のフライトでも「今飛んでいる」ように表示。
          </p>
        </Section>

        <Section id="settings-adsb" heading="3-4. ADS-B 受信設定">
          <ul className="list-disc ml-5 space-y-1 text-sm" style={{ color: "var(--color-text-secondary)" }}>
            <li><strong>ADS-B 受信を有効にする</strong>チェックボックス（ブラウザ + サーバ） — adsb-pollerサービスのON/OFF</li>
            <li><strong>tar1090 / dump1090 URL</strong>（ブラウザ + サーバ） — aircraft.jsonエンドポイント。デフォルト: <code>http://fr24.local/tar1090/data/aircraft.json</code>。<code>http://</code> か <code>https://</code> で始まる必要があり、空白・引用符・改行などを含むURLは保存できません</li>
            <li><strong>ポーリング間隔（秒）</strong>（ブラウザ + サーバ） — 1〜30秒</li>
          </ul>

          <p className="text-sm mt-3 mb-1" style={{ color: "var(--color-text-secondary)" }}>
            以下の2つは<strong>受信機を持たない端末でも使える追加表示</strong>です。インターネット接続が必要で、どちらも<strong>フライトログには記録しません</strong>（地図の表示だけに使います）。管理者ログインなしで切り替えられます。
          </p>
          <ul className="list-disc ml-5 space-y-1 text-sm" style={{ color: "var(--color-text-secondary)" }}>
            <li><strong>OpenなADS-Bを追加（adsb.lol）</strong>（ブラウザ） — 公開データ <code>adsb.lol</code> から<strong>滑空場中心・半径20海里</strong>の ADS-B / Mode-S 機を取得して<span style={{ color: "#1565c0", fontWeight: 600 }}>青</span>で表示します。ADS-B受信機や tar1090 は不要です。5秒ごとに更新し、過去10分の航跡も描きます。
              <ul className="list-[circle] ml-5 mt-1 space-y-1">
                <li>ローカル受信（上の「ADS-B 受信を有効にする」）と<strong>同じ機体は二重に表示しません</strong>。ローカル受信側を優先します。</li>
                <li>ONにした時点で取得を開始します。OFFにすると表示中の機体も消えます。</li>
              </ul>
            </li>
            <li><strong>OpenなOGNを追加（OGNネットワーク）</strong>（ブラウザ） — OGNネットワーク（<code>aprs.glidernet.org</code>）へ直接接続し、<strong>滑空場中心・半径50海里</strong>の OGN 機を取得して表示します。<strong>自局の受信圏外にいる機体</strong>を広く把握できます。
              <ul className="list-[circle] ml-5 mt-1 space-y-1">
                <li><strong>同じ機体はローカル受信を優先</strong>します（アドレス6桁で判定）。直接受信できている機体はローカル側だけを表示し、圏外の機体だけをネットワークから補います。</li>
                <li>プライバシー設定を尊重します。ノートラッキング機はネットワーク側から配信されず、匿名機（ランダムID）は取り込み時に除外します。</li>
                <li>表示は通常の受信機体と<strong>同じ緑のアイコン</strong>で、見た目では区別しません。登録番号は端末の機体データベース（OGN DDB／FlarmNet）で補い、分からなければアドレス6桁を出します。<strong>航跡は描きません</strong>（位置のみ）。</li>
                <li>自局の受信品質の確認にも使えます。ネットワークには出ているのに自局で拾えていない機体があれば、アンテナや設置場所を見直す手がかりになります。</li>
              </ul>
            </li>
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
          <div className="mt-2 p-2 rounded text-xs" style={{ background: "var(--color-warning-dim)", color: "var(--color-warning)", border: "1px solid var(--color-warning)" }}>
            <strong>⚠ 機体情報を残したい場合は固定化をOFFにしてください。</strong><br />
            固定化中に残らないもの（再起動でリセット）:
            <strong>機体情報</strong>（登録番号・コンテストID・機種・曳航機の指定）、
            飛行場設定、ADS-B設定、管理者パスワード、ネットワーク設定。<br />
            固定化中でも残るもの: <strong>OGN受信機の設定</strong>（受信機名・位置・周波数補正・AGC）。
            これらは <code>/boot</code> にあり固定化の対象外です。<br />
            機体の顔ぶれが変わる間は固定化をOFFのまま運用し、落ち着いてから固定化してください。
            固定化後に機体を追加するときは「固定化を解除して再起動」→ 登録 → 「固定化を有効にして再起動」の順です。
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

        <Section id="settings-auth" heading="3-11. 管理者認証（ログイン）">
          <ul className="list-disc ml-5 space-y-1 text-sm" style={{ color: "var(--color-text-secondary)" }}>
            <li>設定の<strong>閲覧は誰でも可能</strong>ですが、<strong>変更には管理者ログインが必要</strong>です。</li>
            <li><strong>未ログイン時は、設定画面のすべての入力欄・ボタンが無効（グレーアウト）</strong>になり、一切の設定変更・電源操作ができません。管理者パスワードでログインすると、通常どおり操作できるようになります。</li>
            <li><strong>初期パスワードは <code>admin</code></strong>。設定画面上部で変更できます（4文字以上）。初期パスワードのままだと注意が表示されます。</li>
            <li><strong>唯一の例外が「リモートサポート」</strong>です。ログインしていなくても操作できます（パスワード失念時の復旧導線を兼ねるため）。</li>
            <li>設定変更・IGCファイルのアップロードと削除・ログの閲覧は、ログインしていなければ<strong>受信機が受け付けません</strong>。</li>
            <li>パスワードを<strong>失念した場合</strong>は、リモートサポートを有効化して管理者(サポート担当)にリセットを依頼できます（下記）。リモートサポートのON/OFFは<strong>ログイン不要</strong>です。</li>
          </ul>
        </Section>

        <Section id="settings-remote-support" heading="3-12. リモートサポート（CATVPN）">
          <ul className="list-disc ml-5 space-y-1 text-sm" style={{ color: "var(--color-text-secondary)" }}>
            <li><strong>既定はOFF</strong>。困ったときだけ「リモートサポートを許可する」をONにすると、サポート担当だけが安全な保守用トンネル(CATVPN)経由で接続できます。</li>
            <li><strong>ONにすると、自分でOFFにするまで有効なまま</strong>です。再起動してもONのままです。OFFにすれば即座に切れます。用が済んだらOFFに戻してください。</li>
            <li>ON の間は<strong>接続が切れても自動で復旧</strong>を試みます。通信が5分以上途切れるとトンネルを繋ぎ直します（再試行は10分間隔）。</li>
            <li>ONにしても、その端末に入れるのは<strong>サポート担当のみ</strong>で、あなたの他の機器へは到達できません（相互隔離）。ON/OFFの切替に<strong>パスワードは不要</strong>です（失念時の解除導線を兼ねます）。</li>
            <li>サポート担当はリモートサポート中、パスワードなしで設定変更・パスワードリセットが可能です（VPN上の本人性で認可）。</li>
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
            <li><strong>設定を保存して受信機を再起動</strong> — 設定変更を保存＋rtlsdr-ogn再起動。書き込んだ内容を読み戻して確認し、一致したときだけ成功と表示します</li>
            <li><strong>受信機のみ再起動</strong> — 設定は変更せずrtlsdr-ognだけ再起動</li>
            <li>どちらも<strong>完了まで1〜2分かかります</strong>。受信機の起動は時刻合わせとOGN公式の設定マネージャ（疎通確認・自己更新）を済ませてから始まるためです。状態ページが実際に応答したことを確かめてから結果を出すので、画面が返るまで閉じずにお待ちください</li>
            <li><strong>保存内容を確認</strong> — 保存せずに、設定ファイル・再インストール用の設定・受信機が実際に使っている値を並べて比べます。食い違っていればその場所と理由（所有者・パーミッション・エラー内容）を表示します</li>
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
            <li><strong>オンライン取得</strong>ボタン — OGN DDB と FlarmNet から JA 登録機の情報を取り込みます（下記）</li>
            <li><strong>+ 新規追加</strong>ボタン — 機体情報を手動追加</li>
            <li><strong>編集</strong>ボタン — 既存レコードを編集</li>
            <li><strong>削除</strong>ボタン — レコード削除（確認ダイアログ）</li>
            <li>未登録のFLARM機体がマップに出現すると、Device IDだけが自動登録されます（後から登録番号等を追記可能）</li>
          </ul>
        </Section>

        <Section id="aircraft-db-online" heading="オンライン取得">
          <p className="text-sm mb-2" style={{ color: "var(--color-text-secondary)" }}>
            OGN DDB（機体登録データベース）と FlarmNet から、<strong>JA 登録機</strong>の情報をまとめて取り込みます。
            登録記号が空欄のまま残っている機体を埋めるのに使います。
          </p>
          <ul className="list-disc ml-5 space-y-1 text-sm" style={{ color: "var(--color-text-secondary)" }}>
            <li>取り込む項目は<strong>登録記号・機種・コンテストナンバー・操縦者名</strong>です。ネット側に値があれば、手で入力した値でも上書きされます</li>
            <li>ネット側に値が無い項目は、<strong>手で入力した内容がそのまま残ります</strong></li>
            <li><strong>機体種別（グライダー / 曳航機 など）は変更しません。</strong>どちらのサービスにも無い情報で、曳航の判定に使っているためです</li>
            <li>本人が識別の公開を拒否している機体（DDB の設定）は取り込みません</li>
            <li>ネットに出られない場合は失敗します。結果は実行後に画面へ表示されます</li>
            <li><strong>固定化(OverlayFS)がONでも実行できます。</strong>ただし取り込んだ内容はメモリ上にだけ残り、再起動すると元に戻ります（追加・編集・削除と同じ扱いです）</li>
            <li>取り込んだあとに手で直すと、登録番号に <span style={{ color: "var(--color-warning)" }}>⚠</span> が付きます。オンライン側が登録の正本なので、こちらの値が誤っている可能性があるという印です。次にオンライン取得すると正本の値へ戻ります</li>
          </ul>
          <p className="text-xs mt-2" style={{ color: "var(--color-text-secondary)" }}>
            機体IDの前3文字（ICA / FLR / OGN）は、同じ機体でも受信した電波の種別と登録内容で食い違うことがあります。
            突き合わせは後ろ6桁のアドレスで行うため、前3文字が違っても同じ機体として扱われます。
          </p>
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
      {/* v1.4.11 */}
      <div className="flex items-center gap-3 mb-2">
        <span className="text-base font-bold" style={{ color: "var(--color-accent)" }}>v1.4.11</span>
        <span className="text-sm" style={{ color: "var(--color-text-secondary)" }}>2026-09-23</span>
        <span className="px-2 py-0.5 rounded text-xs font-medium" style={{ background: "var(--color-accent-light)", color: "var(--color-accent)" }}>最新</span>
      </div>

      <Card title="マップの操作性・表示を大幅強化">
        <ul className="list-disc ml-5 space-y-1 text-sm" style={{ color: "var(--color-text-secondary)" }}>
          <li><strong>機体クリックで「このフライト」の航跡（青の実線）と右上の詳細パネル</strong>を表示。<strong>地図の余白クリックで自動的に閉じます</strong>（詳細パネルはサイドバー上部から地図右上へ移動）。</li>
          <li><strong>機体アイコンのスムーズ表示</strong> — 位置は補間アニメーションで滑らかに移動し、機首の向きも最短方向へ滑らかに回転します。ブラウザを背後にして戻したときに溜まった動きを一気に再生して「くるくる回る」現象も防止しました。</li>
          <li><strong>同心円表示</strong> — 滑空場を中心に5km毎・30kmまでの距離円（点線・距離ラベル付き）を表示（既定ON。設定でOFF可）。</li>
        </ul>
      </Card>

      <Card title="フライトログの改善">
        <ul className="list-disc ml-5 space-y-1 text-sm" style={{ color: "var(--color-text-secondary)" }}>
          <li><strong>着陸のみの記録</strong> — 離陸を観測できなかった機体（外来機の飛来、離陸後に FLARM の電源を入れた等）も、着陸を検知した時点で<strong>離陸欄を空欄にした記録</strong>を残すようにしました。</li>
          <li><strong>登録番号欄にコンテストナンバーを併記</strong> — 例: <code>JA03KH (KH)</code>（CN未登録の機体は従来どおり）。</li>
        </ul>
      </Card>

      <Card title="ステータス画面に「Open データ源」の実受信状態を追加">
        <ul className="list-disc ml-5 space-y-1 text-sm" style={{ color: "var(--color-text-secondary)" }}>
          <li>Open ADS-B（adsb.lol）と Open OGN（aprs.glidernet.org）が<strong>実際に受信できているか</strong>を表示。<strong>設定ONでも受信できていない場合は失敗理由まで</strong>分かります。</li>
        </ul>
      </Card>

      <Card title="Open ADS-B の接続方式を変更（v1.4.10の追加修正）">
        <ul className="list-disc ml-5 space-y-1 text-sm" style={{ color: "var(--color-text-secondary)" }}>
          <li>v1.4.10 の接続タイムアウト対策が <strong>Next.js の fetch 実装では効かない</strong>ことが実機で判明したため、adsb.lol への取得を <strong>IPv4 直行の HTTPS 接続</strong>に変更しました（実機で接続成功を実証済み）。</li>
        </ul>
      </Card>

      <Card title="マニュアル修正">
        <ul className="list-disc ml-5 space-y-1 text-sm" style={{ color: "var(--color-text-secondary)" }}>
          <li>「サイドバー（左）」の表記を実際のレイアウトに合わせて<strong>「サイドバー（右）」</strong>に修正。新機能の説明を追加。</li>
        </ul>
      </Card>

      {/* v1.4.10 */}
      <div className="flex items-center gap-3 mb-2">
        <span className="text-base font-bold" style={{ color: "var(--color-accent)" }}>v1.4.10</span>
        <span className="text-sm" style={{ color: "var(--color-text-secondary)" }}>2026-09-23</span>
      </div>

      <Card title="Open ADS-B が表示されない問題を修正（全サイト共通）">
        <ul className="list-disc ml-5 space-y-1 text-sm" style={{ color: "var(--color-text-secondary)" }}>
          <li>日本からデータ元（adsb.lol・欧州サーバ）への接続が、Node の接続試行タイムアウト（250ms）より通信の往復時間（約290ms）が長いために<strong>毎回失敗していた問題を修正</strong>しました。試行猶予を2秒に延長し、機体情報のオンライン取得など他の外部通信も同時に改善されます。</li>
          <li>取得に失敗した場合、<strong>失敗理由（<code>last_error</code>）を API 応答に出す</strong>ようにしました。従来は無音で失敗し原因調査が困難でした。</li>
          <li>失敗が続いてもリクエスト毎に再試行せず一定間隔に間引くようにし、データ元のレート制限（429）を悪化させないようにしました。</li>
        </ul>
      </Card>

      {/* v1.4.9 */}
      <div className="flex items-center gap-3 mb-2">
        <span className="text-base font-bold" style={{ color: "var(--color-accent)" }}>v1.4.9</span>
        <span className="text-sm" style={{ color: "var(--color-text-secondary)" }}>2026-09-22</span>
      </div>

      <Card title="OGN受信機の自動復帰（ウォッチドッグ）を各機へ確実に配布">
        <ul className="list-disc ml-5 space-y-1 text-sm" style={{ color: "var(--color-text-secondary)" }}>
          <li>再起動後などに<strong>OGN受信機が上がらなくても、ウォッチドッグが自動で復帰</strong>させる仕組みを、更新のたびに確実に導入するようにしました（<code>feeldscope-converge.sh</code> に集約）。</li>
          <li>受信方式（rtlsdr-ogn／SkyLens／ADS-B専用）は端末ごとの設定を尊重し<strong>勝手に切り替えません</strong>。受信機の無い端末では何もしません（無害）。</li>
        </ul>
      </Card>

      {/* v1.4.8 */}
      <div className="flex items-center gap-3 mb-2">
        <span className="text-base font-bold" style={{ color: "var(--color-accent)" }}>v1.4.8</span>
        <span className="text-sm" style={{ color: "var(--color-text-secondary)" }}>2026-09-22</span>
      </div>

      <Card title="地図の機体アイコンに機番・高度・速度のラベルを追加">
        <ul className="list-disc ml-5 space-y-1 text-sm" style={{ color: "var(--color-text-secondary)" }}>
          <li>各機体アイコンの<strong>上に表示名（機番／コンテストナンバー／パイロット）</strong>、<strong>下に高度・速度</strong>を常時表示するようにしました（従来はアイコンの右側に表示）。</li>
          <li>ラベルは背景に応じた縁取り付きで、ライト／ダークどちらのテーマでも読みやすくしています。</li>
          <li>ナビゲーションバーの<strong>滑空場名</strong>が読み込み直後に一瞬別名で表示されることがあった問題を修正（初期表示は空欄にし、サーバ設定の取得後に正しい名前を表示）。</li>
        </ul>
      </Card>

      {/* v1.4.7 */}
      <div className="flex items-center gap-3 mb-2">
        <span className="text-base font-bold" style={{ color: "var(--color-accent)" }}>v1.4.7</span>
        <span className="text-sm" style={{ color: "var(--color-text-secondary)" }}>2026-09-22</span>
      </div>

      <Card title="機体データベースの破損に強くしました">
        <ul className="list-disc ml-5 space-y-1 text-sm" style={{ color: "var(--color-text-secondary)" }}>
          <li>機体データベースのファイルが万一壊れていても、<strong>「機体情報のオンライン取得」など機体DB機能が止まらない</strong>ようにしました。壊れた内容は自動的に退避（<code>.corrupt-…</code>）し、可能な範囲を救出して継続します。</li>
          <li>機体データベースの保存を<strong>安全な書き込み方式（一時ファイル→置換）</strong>に変更。保存中に再起動が重なってもファイルが壊れにくくなりました。</li>
        </ul>
      </Card>

      {/* v1.4.6 */}
      <div className="flex items-center gap-3 mb-2">
        <span className="text-base font-bold" style={{ color: "var(--color-accent)" }}>v1.4.6</span>
        <span className="text-sm" style={{ color: "var(--color-text-secondary)" }}>2026-09-22</span>
      </div>

      <Card title="OpenなOGNで一部の機体（Naviter系）が表示されない不具合を修正">
        <ul className="list-disc ml-5 space-y-1 text-sm" style={{ color: "var(--color-text-secondary)" }}>
          <li>Naviter系（OGNAVI）経由で中継される機体は、OGNの識別子(id)の桁数が標準と異なるため、<strong>「OpenなOGN」の地図に表示されないこと</strong>がありました（登録済みの機体でも欠落）。</li>
          <li>桁数の異なる識別子にも対応し、これらの機体も表示されるようにしました。アドレス種別は発信元コールサイン（FLR/ICA/OGN）で判定します。自局で直接受信・記録する機体には影響ありません。</li>
        </ul>
      </Card>

      {/* v1.4.5 */}
      <div className="flex items-center gap-3 mb-2">
        <span className="text-base font-bold" style={{ color: "var(--color-accent)" }}>v1.4.5</span>
        <span className="text-sm" style={{ color: "var(--color-text-secondary)" }}>2026-09-21</span>
      </div>

      <Card title="リポジトリの履歴整理に備えた更新処理">
        <ul className="list-disc ml-5 space-y-1 text-sm" style={{ color: "var(--color-text-secondary)" }}>
          <li>配布元（GitHub）の過去の履歴から、公開すべきでない情報を取り除く作業を予定しています。</li>
          <li>履歴を整理すると、これまでの更新処理では<strong>アップデートが失敗して止まってしまいます</strong>。この版から、履歴が整理されていても自動で追従して更新できるようにしました。</li>
          <li>各端末の設定・機体情報・記録は Git で管理していないため、影響はありません。画面と動作にも変わりはありません。</li>
        </ul>
      </Card>

      {/* v1.4.4 */}
      <div className="flex items-center gap-3 mb-2">
        <span className="text-base font-bold" style={{ color: "var(--color-accent)" }}>v1.4.4</span>
        <span className="text-sm" style={{ color: "var(--color-text-secondary)" }}>2026-09-21</span>
      </div>

      <Card title="ソースの整理">
        <ul className="list-disc ml-5 space-y-1 text-sm" style={{ color: "var(--color-text-secondary)" }}>
          <li>使われていないコードと、役目を終えた開発用のメモ・資料を削除しました。<strong>画面と動作に変わりはありません</strong>。</li>
          <li>新規インストールの際、開発用の解析ツールや記録を端末へコピーしないようにしました。端末へ送るのはシミュレーター用の IGC ファイルだけです。</li>
        </ul>
      </Card>

      {/* v1.4.3 */}
      <div className="flex items-center gap-3 mb-2">
        <span className="text-base font-bold" style={{ color: "var(--color-accent)" }}>v1.4.3</span>
        <span className="text-sm" style={{ color: "var(--color-text-secondary)" }}>2026-09-21</span>
      </div>

      <Card title="OpenなADS-B・OpenなOGN の説明をマニュアルに追加">
        <ul className="list-disc ml-5 space-y-1 text-sm" style={{ color: "var(--color-text-secondary)" }}>
          <li>設定画面に追加した <strong>「OpenなADS-Bを追加（adsb.lol）」</strong> と <strong>「OpenなOGNを追加（OGNネットワーク）」</strong> が、マニュアルに載っていませんでした。<strong>3-4. ADS-B 受信設定</strong> に追記しました。</li>
          <li>取得範囲・更新間隔・ローカル受信との重複回避・プライバシーの扱い・フライトログに記録しないことを記載しました。</li>
          <li>OpenなOGN で補った機体は<strong>通常の受信機体と同じ緑のアイコン</strong>で表示され、<strong>航跡は描きません</strong>。見分けがつかず迷いやすい点なので、マニュアルと地図の凡例の両方に明記しました。</li>
        </ul>
      </Card>

      {/* v1.4.2 */}
      <div className="flex items-center gap-3 mb-2">
        <span className="text-base font-bold" style={{ color: "var(--color-accent)" }}>v1.4.2</span>
        <span className="text-sm" style={{ color: "var(--color-text-secondary)" }}>2026-09-21</span>
      </div>

      <Card title="運用中に地図と飛行ログの更新が止まる問題を改修">
        <ul className="list-disc ml-5 space-y-1 text-sm" style={{ color: "var(--color-text-secondary)" }}>
          <li>匿名機（ランダムID）を個体として扱わない対策は、v1.4.1 では<strong>画面側だけ</strong>に入っていました。受信側は1機ずつ配信し続けていたため機体情報が内部に溜まり続け、<strong>運用中に地図と飛行ログの更新が止まる</strong>ことがありました（受信とOGNへのアップロードは継続します）。</li>
          <li>受信側でも匿名機を個体として扱わないようにしました。位置は引き続き配信するので、<strong>地図の灰色「?」表示は変わりません</strong>。</li>
          <li>前日以前の機体情報を抱え続けないようにしました。運用日が変わると自動で片付きます。</li>
          <li>受信しなくなった機体の情報を内部から確実に消すようにしました。長時間の連続運転でも溜まりません。</li>
        </ul>
      </Card>

      <Card title="配信の仕組みを再起動したあと受信データが戻らない問題を改修">
        <ul className="list-disc ml-5 space-y-1 text-sm" style={{ color: "var(--color-text-secondary)" }}>
          <li>メッセージ配信の仕組みを再起動すると、受信データを送り出す処理が道連れで停止し、<strong>そのまま復帰しません</strong>でした。地図と飛行ログが更新されなくなります。</li>
          <li>道連れで止まらないようにし、万一止まっても自動で復帰するようにしました。</li>
        </ul>
      </Card>

      {/* v1.4.1 */}
      <div className="flex items-center gap-3 mb-2">
        <span className="text-base font-bold" style={{ color: "var(--color-accent)" }}>v1.4.1</span>
        <span className="text-sm" style={{ color: "var(--color-text-secondary)" }}>2026-09-21</span>
      </div>

      <Card title="OpenなOGN を OGNネットワークへ直接接続する方式に変更">
        <ul className="list-disc ml-5 space-y-1 text-sm" style={{ color: "var(--color-text-secondary)" }}>
          <li>OpenなOGN（OGNネットワーク）の取得を、外部サイト経由ではなく <strong>OGNネットワーク（aprs.glidernet.org）へ直接接続</strong>して行う方式にしました。特定サイトに依存せず取得できます（範囲は空港中心50海里のまま）。</li>
          <li>設定画面・ヘルプの表記を「OGNネットワーク」に更新しました。動作（ローカル優先マージ・プライバシー除外）は変わりません。</li>
        </ul>
      </Card>

      {/* v1.4.0 */}
      <div className="flex items-center gap-3 mb-2">
        <span className="text-base font-bold" style={{ color: "var(--color-accent)" }}>v1.4.0</span>
        <span className="text-sm" style={{ color: "var(--color-text-secondary)" }}>2026-09-21</span>
      </div>

      <Card title="Open OGN（OGNネットワークの機体をローカル受信とマージ）">
        <ul className="list-disc ml-5 space-y-1 text-sm" style={{ color: "var(--color-text-secondary)" }}>
          <li>設定画面に <strong>「OpenなOGNを追加（OGNネットワーク）」</strong> チェックボックスを追加しました。ONにすると、ローカル受信に加えて <strong>OGNネットワークの機体（空港周辺・半径50海里）</strong>を取得して表示します。受信機の圏外にいる機体を広く把握できます。</li>
          <li><strong>同じ機体はローカル受信を優先</strong>します（6桁hexで判定し、直接受信している機はローカル側だけを表示、圏外の機だけをネットワークから補完）。二重には表示されません。</li>
          <li>プライバシー配慮（no-tracking は APRS-IS 側で配信されず、匿名ランダムID は取り込み時に除外）。フライトログには記録しません。</li>
        </ul>
      </Card>

      {/* v1.3.1 */}
      <div className="flex items-center gap-3 mb-2">
        <span className="text-base font-bold" style={{ color: "var(--color-accent)" }}>v1.3.1</span>
        <span className="text-sm" style={{ color: "var(--color-text-secondary)" }}>2026-09-21</span>
      </div>

      <Card title="Open ADS-B の表示範囲を空港中心 20海里 に設定">
        <ul className="list-disc ml-5 space-y-1 text-sm" style={{ color: "var(--color-text-secondary)" }}>
          <li>Open ADS-B（adsb.lol）の取得・表示範囲を<strong>空港中心 半径20海里</strong>に絞りました（従来は約250海里）。周辺の近距離トラフィックに集中でき、通信・描画の負荷も軽くなります。</li>
        </ul>
      </Card>

      {/* v1.3.0 */}
      <div className="flex items-center gap-3 mb-2">
        <span className="text-base font-bold" style={{ color: "var(--color-accent)" }}>v1.3.0</span>
        <span className="text-sm" style={{ color: "var(--color-text-secondary)" }}>2026-09-21</span>
      </div>

      <Card title="Open ADS-B（受信機なしで ADS-B 表示）と、匿名機（ランダムID）の扱いを追加">
        <ul className="list-disc ml-5 space-y-1 text-sm" style={{ color: "var(--color-text-secondary)" }}>
          <li><strong>OpenなADS-Bを追加</strong> — 設定画面の「ADS-B 受信設定」にチェックボックスを追加しました。ONにすると、<strong>ADS-B受信機やローカルの tar1090 が無くても</strong>、公開データ（adsb.lol）から<strong>空港周辺の ADS-B 機</strong>を取得して青色で表示します（当初は約250海里、v1.3.1で20海里に変更）。5秒ごとに更新し、過去10分の航跡も表示します（フライトログには記録しません）。データ元: adsb.lol。</li>
          <li><strong>匿名機（ランダムID）の扱い</strong> — <code>RND</code> で始まる機体は、追跡されないために送信のたびIDが変わる privacy 機（FLARM の random/EPRA）です。これまでは送信のたびに別機として大量に表示され地図が混雑していました。今後は<strong>個体として追跡・識別せず、位置だけをまとめて灰色の「?」1個</strong>で表示します（登録番号の解決・航跡・機体DB登録は行いません）。OGN/FLARM のプライバシー方針に沿った表示です。</li>
        </ul>
      </Card>

      {/* v1.2.12 */}
      <div className="flex items-center gap-3 mb-2">
        <span className="text-base font-bold" style={{ color: "var(--color-accent)" }}>v1.2.12</span>
        <span className="text-sm" style={{ color: "var(--color-text-secondary)" }}>2026-09-20</span>
      </div>

      <Card title="フライトログと機体情報の変更を記録に残すようにしました">
        <ul className="list-disc ml-5 space-y-1 text-sm" style={{ color: "var(--color-text-secondary)" }}>
          <li>フライトログと機体情報データベースの書き換え（追加・編集・削除・全消去）が、<strong>いつ・どこから・何が変わったか</strong>システムログに残ります。動作はこれまでと変わりません。</li>
          <li>とくに<strong>行の削除・全消去・入っていた値が空になった</strong>ときは目立つ印を付けて記録します。「記録していたはずの値が無い」というときに、後から経緯をたどれます。</li>
          <li>地図の時刻欄は1文字入力するたびに保存されるため、同じ内容の記録はまとめて1行にします。ただし値が消えた場合は必ず個別に記録します。</li>
          <li>確認は設定画面の「サポート情報」から行えます。</li>
        </ul>
      </Card>

      {/* v1.2.11 */}
      <div className="flex items-center gap-3 mb-2">
        <span className="text-base font-bold" style={{ color: "var(--color-accent)" }}>v1.2.11</span>
        <span className="text-sm" style={{ color: "var(--color-text-secondary)" }}>2026-09-20</span>
      </div>

      <Card title="登録番号がオンラインDBと食い違う機体に印を付けるようにしました">
        <ul className="list-disc ml-5 space-y-1 text-sm" style={{ color: "var(--color-text-secondary)" }}>
          <li>機体情報データベースで、登録番号が<strong>オンラインDB（OGN DDB / FlarmNet）の値と違う</strong>場合に <span style={{ color: "var(--color-warning)" }}>⚠</span> とオンライン側の値を並べて表示します。オンライン側が登録の正本なので、<strong>こちらの値が誤っている可能性がある</strong>という印です。</li>
          <li>印にマウスを乗せると、オンライン側の値・こちらの値・最後にオンライン取得した日時が出ます。</li>
          <li>オンライン取得を実行すると正本の値に揃うので、印は消えます。</li>
        </ul>
      </Card>

      <Card title="固定化中でもオンライン取得を使えるようにしました">
        <ul className="list-disc ml-5 space-y-1 text-sm" style={{ color: "var(--color-text-secondary)" }}>
          <li>固定化(OverlayFS)がONのときに<strong>オンライン取得ボタンが押せなくなっていた</strong>のを直しました。追加・編集・削除と同じように使えます。</li>
          <li>固定化中は、取り込んだ内容が<strong>メモリ上にだけ残り再起動で元に戻る</strong>旨を、実行前の確認と実行結果の両方に表示します。</li>
        </ul>
      </Card>

      {/* v1.2.10 */}
      <div className="flex items-center gap-3 mb-2">
        <span className="text-base font-bold" style={{ color: "var(--color-accent)" }}>v1.2.10</span>
        <span className="text-sm" style={{ color: "var(--color-text-secondary)" }}>2026-09-20</span>
      </div>

      <Card title="機体情報を OGN DDB と FlarmNet からまとめて取り込めるようにしました">
        <ul className="list-disc ml-5 space-y-1 text-sm" style={{ color: "var(--color-text-secondary)" }}>
          <li>機体情報データベースの画面に<strong>「オンライン取得」ボタン</strong>を追加しました。押すと OGN DDB と FlarmNet から JA 登録機の<strong>登録記号・機種・コンテストナンバー・操縦者名</strong>を取り込みます。</li>
          <li>ネット側に値がある項目は手入力でも上書きし、<strong>ネット側に無い項目は手入力のまま残します</strong>。<strong>機体種別（グライダー / 曳航機 など）は変更しません</strong>（曳航の判定に使っているため）。</li>
          <li>機体IDの前3文字（ICA / FLR / OGN）は同じ機体でも食い違うことがあるため、後ろ6桁のアドレスで突き合わせます。これにより、これまで登録記号が空欄のまま残っていた機体も埋まるようになりました。</li>
        </ul>
      </Card>

      {/* v1.2.9 */}
      <div className="flex items-center gap-3 mb-2">
        <span className="text-base font-bold" style={{ color: "var(--color-accent)" }}>v1.2.9</span>
        <span className="text-sm" style={{ color: "var(--color-text-secondary)" }}>2026-09-20</span>
      </div>

      <Card title="システム更新で、不要になったファイルが端末に残らないようにしました">
        <ul className="list-disc ml-5 space-y-1 text-sm" style={{ color: "var(--color-text-secondary)" }}>
          <li>これまでのシステム更新は新しいファイルを上書きするだけで、<strong>使わなくなったファイルを端末から消していませんでした</strong>。そのため、以前の版で取りやめた機能が端末に残り、動き続けていることがありました。バージョン表示は新しくなるため、画面からは気づけません。</li>
          <li>更新のたびに端末側を最新の構成に揃えるようにしました。<strong>次回のシステム更新で、残っていたファイルは自動的に片付きます</strong>。設定や機体データ、IGCファイルなど端末ごとの情報はこれまでどおり残ります。</li>
        </ul>
      </Card>

      {/* v1.2.8 */}
      <div className="flex items-center gap-3 mb-2">
        <span className="text-base font-bold" style={{ color: "var(--color-accent)" }}>v1.2.8</span>
        <span className="text-sm" style={{ color: "var(--color-text-secondary)" }}>2026-09-20</span>
      </div>

      <Card title="フライトログの離脱距離を手で直せるようにしました">
        <ul className="list-disc ml-5 space-y-1 text-sm" style={{ color: "var(--color-text-secondary)" }}>
          <li>これまで離脱高度だけが編集できて、<strong>離脱距離は表示だけ</strong>でした。距離も同じように入力できます。単位の設定（km / nm）に合わせて表示と入力が切り替わり、小数も入れられます。空欄にすると未記録に戻せます。</li>
        </ul>
      </Card>

      <Card title="設定画面で保存した内容が元に戻って見えることがあったのを直しました">
        <ul className="list-disc ml-5 space-y-1 text-sm" style={{ color: "var(--color-text-secondary)" }}>
          <li>自動再起動などを保存したあと、<strong>画面の表示だけが元の値に戻る</strong>ことがありました。設定そのものは正しく保存されていて、画面を再読み込みすると正しい値が出る、という症状です。保存した内容がそのまま画面に残るようにしました。</li>
          <li>あわせて、設定画面を開いている間の応答が遅かったのを改善しました（実測で約11秒 → 0.3秒）。</li>
        </ul>
      </Card>

      <Card title="受信した位置に付いている情報の読み取りを修正しました">
        <ul className="list-disc ml-5 space-y-1 text-sm" style={{ color: "var(--color-text-secondary)" }}>
          <li>受信機が位置ごとに出している状態の読み取りがずれており、<strong>ステルス設定の機体が正しく区別できていませんでした</strong>。読み取りを実際の形式に合わせ直しました。</li>
          <li>あわせて、離陸の判定で「受信機がまだ地上と言っている間は飛行を作らない」確認を追加しました。格納庫の近くなどで位置が乱れたときに、飛んでいない機体の飛行が記録されるのを防ぎます。</li>
        </ul>
      </Card>

      {/* v1.2.7 */}
      <div className="flex items-center gap-3 mb-2">
        <span className="text-base font-bold" style={{ color: "var(--color-accent)" }}>v1.2.7</span>
        <span className="text-sm" style={{ color: "var(--color-text-secondary)" }}>2026-09-18</span>
      </div>

      <Card title="SkyLensモードの端末で自動復帰が誤作動していたのを直しました">
        <ul className="list-disc ml-5 space-y-1 text-sm" style={{ color: "var(--color-text-secondary)" }}>
          <li>v1.2.5 で追加した受信機の自動復帰が、SkyLensモードの端末でも「受信機が止まっている」と判断して rtlsdr-ogn を起こしてしまっていました。SDRはSkyLensが使っているため、起こされた側はドングルを開けないまま居座り、<strong>状態タブに「稼働中なのに中心周波数もノイズも表示されない」</strong>という形で現れます。</li>
          <li>受信方式の判断に <code>rtlsdr-ogn</code> の有効・無効を見るようにしました。SkyLensモードの端末では自動復帰は何もしません（リモートサポートの監視が wg0 の有効・無効を見ているのと同じ考え方です）。</li>
        </ul>
      </Card>

      {/* v1.2.6 */}
      <div className="flex items-center gap-3 mb-2">
        <span className="text-base font-bold" style={{ color: "var(--color-accent)" }}>v1.2.6</span>
        <span className="text-sm" style={{ color: "var(--color-text-secondary)" }}>2026-09-18</span>
      </div>

      <Card title="状態タブの「rtlsdr-ogn」が常に停止中と出ていたのを直しました">
        <ul className="list-disc ml-5 space-y-1 text-sm" style={{ color: "var(--color-text-secondary)" }}>
          <li>状態タブのサービス一覧の <code>rtlsdr-ogn (init.d)</code> は、受信機が動いていても常に「停止中」と表示されていました。稼働判定が「running」という文字を探す作りで、受信機の起動スクリプトはそう言わないためです。</li>
          <li>プロセス表を読んで判定するようにしました。ogn-rf と ogn-decode の片方だけが落ちている状態も「停止中」として出します。</li>
        </ul>
      </Card>

      {/* v1.2.5 */}
      <div className="flex items-center gap-3 mb-2">
        <span className="text-base font-bold" style={{ color: "var(--color-accent)" }}>v1.2.5</span>
        <span className="text-sm" style={{ color: "var(--color-text-secondary)" }}>2026-09-18</span>
      </div>

      <Card title="受信機が止まったまま戻らなくなる不具合を直しました">
        <ul className="list-disc ml-5 space-y-1 text-sm" style={{ color: "var(--color-text-secondary)" }}>
          <li><strong>症状</strong> — 「設定を保存して受信機を再起動」や「受信機のみ再起動」を押したあと、受信機が止まったまま戻らなくなることがありました。画面には「再起動しました」と出るのに状態は「停止中」のままで、もう一度押しても直りませんでした。実際に1台で4日半、受信とOGNへのアップロードが止まっていました。</li>
          <li><strong>原因</strong> — 受信機の起動は、時刻合わせとOGN公式の設定マネージャ（疎通確認・自己更新）を済ませてから始まるため60秒前後かかります。画面側がそれを待ち切れずに打ち切ると、起動処理が最後の一歩の手前で道連れになって死んでいました。さらに受信機側の起動スクリプトは、いったんこの状態に落ちると「再起動」では二度と起動しない作りでした。</li>
          <li><strong>対策</strong> — 再起動を「停止」と「起動」に分け、起動処理を画面側から切り離しました。そのうえで<strong>状態ページが実際に応答するまで見届けて</strong>から結果を表示します。止まっているのに「成功」と出ることはなくなります。</li>
          <li><strong>自動復帰を追加</strong> — 受信機が応答しなくなったら、2分ごとの見回りで自動的に起動し直します。無人設置でも自力で戻ります（止めたいときは <code>/boot/feeldscope-ogn-watchdog.disabled</code> を置いてください）。</li>
        </ul>
      </Card>

      <Card title="設定ファイルの改行の壊れを見つけて直せるようにしました">
        <ul className="list-disc ml-5 space-y-1 text-sm" style={{ color: "var(--color-text-secondary)" }}>
          <li><code>/boot/OGN-receiver.conf</code> の改行にCRが混じると、受信機側はキーを1つも読めなくなります。受信機名が読めず、OGNバイナリのダウンロード先も日本向け（<code>?version=japan</code>）ではなく既定の欧州版に落ちるため、<strong>922.4MHzではなく868MHzを受信し続ける</strong>という分かりにくい壊れ方をします。Windowsから <code>/boot</code> を直接編集すると混入します。</li>
          <li>設定画面が壊れに気づいて知らせるようにし、保存し直せば改行が直るようにしました。保存後は「受信機側から読める形で書けたか」を読み戻して確認します。</li>
        </ul>
      </Card>

      {/* v1.2.4 */}
      <div className="flex items-center gap-3 mb-2">
        <span className="text-base font-bold" style={{ color: "var(--color-accent)" }}>v1.2.4</span>
        <span className="text-sm" style={{ color: "var(--color-text-secondary)" }}>2026-09-13</span>
      </div>

      <Card title="ソースコードと検証データから機体の登録情報を除きました">
        <ul className="list-disc ml-5 space-y-1 text-sm" style={{ color: "var(--color-text-secondary)" }}>
          <li>v1.2.3 のソースコードのコメントと、同梱の検証データ（飛行ログの記録・解析ツール）に、実在の機体の登録記号が含まれていました。これらを取り除き、解析ツールは各自の手元の機体DBから読むようにしました。</li>
          <li>受信・離着陸・離脱の判定の動作は、v1.2.3 から変わりません。</li>
        </ul>
      </Card>

      {/* v1.2.3 */}
      <div className="flex items-center gap-3 mb-2">
        <span className="text-base font-bold" style={{ color: "var(--color-accent)" }}>v1.2.3</span>
        <span className="text-sm" style={{ color: "var(--color-text-secondary)" }}>2026-09-13</span>
      </div>

      <Card title="電源を入れた直後の FLARM の位置で、飛行記録が壊れる問題を修正しました">
        <ul className="list-disc ml-5 space-y-1 text-sm" style={{ color: "var(--color-text-secondary)" }}>
          <li>電源を入れた直後の FLARM は、GPS が測位を終える前の位置を<strong>1回だけ</strong>出すことがあります。たきかわの実測では「対地3mで 539 km/h・238km 先」「対地8235m・102km 先」という位置が届きました。</li>
          <li>これまではこの1点で機体の状態を決めていたため、<strong>駐機中の機体が「飛行中」になり、その日の1便目の離陸と離脱高度が記録されません</strong>でした（2026-09-13）。反対に、地上にいる機体に<strong>1分ほどの偽の飛行</strong>が記録されることもありました（2026-09-12 に2件）。</li>
          <li>「前の位置と比べて跳んだ位置を捨てる」従来の仕組みは、比べる相手のいない1点目を判定できません。受信機側ではこの1点が基準になり、<strong>続く正常な位置のほうを捨てて</strong>いました。</li>
          <li>初めて受信した機体と、5分以上受信が途切れた機体は、<strong>続けて届いた位置どうしがつながることを確かめてから</strong>使うようにしました（受信機と飛行記録の両方）。遅れるのは受信を始めた直後の数秒だけです。</li>
          <li>離陸は、30 km/h 超と対地20m以上を<strong>それぞれ2回続けて</strong>受け、さらに滑走を始めてから<strong>実際に50m以上動いた</strong>ときに記録します。格納庫の近くで FLARM を入れると、止まったまま「33 km/h・対地31m」のような位置が続くことがあり、2026-09-13 の夕方に1分未満の偽の飛行が記録されていました。記録される離陸時刻は、これまでどおり滑走を始めた時刻です。</li>
          <li>地上にいた機体が長く受信できず、<strong>次に曳航中の上空で見つかった</strong>場合（FLARM の電源を入れたのが離陸後だった等）は、見つかった時刻を離陸時刻にしていました。2026-09-13 には 13:47 の曳航が 13:52 と記録され、離脱高度も入りませんでした。並んで上がっている曳航機がいれば、<strong>その曳航機の離陸時刻を使い、離脱高度も引き継ぐ</strong>ようにしました。受信機を再起動した直後などで、<strong>その日初めて曳航中の上空で見つかった</strong>グライダーも同じように記録します（これまでは記録されませんでした）。並ぶ曳航機がいない上空の機体は、これまでどおり飛行として記録しません。</li>
          <li>それでも状態を誤った場合に備えて、離陸を観測していない「飛行中」の機体が<strong>地上で30秒止まっていたら地上に戻します</strong>。</li>
          <li>たきかわ2日分の実運用データで検証しました。取りこぼしていた便（10:11〜10:33・離脱964m）が記録され、13:52 と記録されていた曳航が 13:47・離脱960m に直り、偽の飛行2件が消え、<strong>ほかの便は1件も変わりません</strong>でした。</li>
        </ul>
      </Card>

      <Card title="離脱の瞬間を受信できなかった曳航は、離脱高度を空欄にしました">
        <ul className="list-disc ml-5 space-y-1 text-sm" style={{ color: "var(--color-text-secondary)" }}>
          <li>曳航機の離脱は「受信できた最高高度から 50m 下がったら、その最高高度を離脱高度とする」方式です。上昇中に受信が途切れ、その間に離脱すると、<strong>途切れる直前の高度が離脱高度として記録</strong>されていました。</li>
          <li>2026-09-13 の実測では、曳航機が 625m で上昇中のまま約5分受信が途切れ、次は降下中でした。グライダーは途切れ明けにすでに 929m にいて、実際の離脱は約930m でしたが、<strong>622m（2041ft）と記録</strong>されていました。</li>
          <li>次の2つの形は、離脱が受信の途切れの中で起きていて観測できていないものとして、<strong>離脱高度を空欄</strong>にします。
            <ul className="list-disc ml-5 mt-1 space-y-1">
              <li>上昇を続けたまま（1.5 m/s 以上）20秒より長く受信が途切れ、明けたときには降下していた</li>
              <li>上昇中に20秒より長く途切れ、明けた最初の位置で<strong>既にはっきり降下していた</strong>（-3 m/s 以下）。その位置は本当の最高点ではありません（2026-09-13 に 920m と記録された曳航は、実際には約960〜970m で離脱していました）</li>
            </ul>
          </li>
          <li>索でつながっていたグライダーも、離脱高度を空欄のまま「離脱済み」にします。飛行中のまま残すと、あとでサーマルを抜けたときの減速を離脱と読み、実際より数百m 高い値が入ることがありました。必要なら手で入力してください。</li>
          <li>上昇が止まりかけた最高点（離脱の瞬間）のあとで途切れた場合や、下がり始めたばかりの位置が最高点の場合は、離脱が見えているので、これまでどおり記録します。2日分の実運用データで、グライダー側の航跡と照らして振り分けが正しいことを確かめました。</li>
        </ul>
      </Card>

      <Card title="飛行記録の判断をシステムログに残すようにしました">
        <ul className="list-disc ml-5 space-y-1 text-sm" style={{ color: "var(--color-text-secondary)" }}>
          <li>離陸・着陸・離脱・曳航ペアの確定・壊れた位置の破棄を、判断のたびに1行ずつ記録します。記録が実際と食い違ったときに、あとから原因を追えます。</li>
          <li>保存先は Web アプリのシステムログです（<code>journalctl -u feeldscope-webapp</code>）。SD カードへの書き込みは増えません。</li>
        </ul>
      </Card>

      {/* v1.2.2 */}
      <div className="flex items-center gap-3 mb-2">
        <span className="text-base font-bold" style={{ color: "var(--color-accent)" }}>v1.2.2</span>
        <span className="text-sm" style={{ color: "var(--color-text-secondary)" }}>2026-09-12</span>
      </div>

      <Card title="電源を切った機体が地図に残り続ける問題を修正しました">
        <ul className="list-disc ml-5 space-y-1 text-sm" style={{ color: "var(--color-text-secondary)" }}>
          <li>運用が終わって FLARM の電源を切った機体が、<strong>いつまでも地図に置かれたまま</strong>になっていました。たきかわでは運用終了の1時間後も10機が残り、そのうち1機は<strong>4か月前の位置</strong>のままでした。</li>
          <li>原因は、受信機の機体リストが一度載った機体を落とさないことです。表示側はこのリストから消えた機体だけを地図から下ろすので、消える機会がありませんでした。リストにある <code>last_seen_sec</code> は経過時間と対応しないため、<strong>位置の時刻</strong>で判断するようにしました。</li>
          <li><strong>地上にいる機体</strong>は、受信が10分間途絶えたら地図から下ろします。</li>
          <li><strong>上空で電波が途切れた機体は残します。</strong>最後に見えた場所は捜すときに必要な情報なので、勝手に消しません。翌朝 5:00 のログブック更新で片付きます。</li>
          <li>受信機側でも、前日以前の位置しか持たない機体を配信対象から外すようにしました。</li>
        </ul>
      </Card>

      <Card title="曳航機の地上滑走が「飛行」として記録される問題を修正しました">
        <ul className="list-disc ml-5 space-y-1 text-sm" style={{ color: "var(--color-text-secondary)" }}>
          <li>曳航機が着陸後に次の索の位置まで地上を戻るとき、<strong>1分未満の飛行が次々と記録される</strong>問題がありました。たきかわの実運用では、1回の戻りで6便の記録が作られていました。</li>
          <li>原因は、離陸の判定が<strong>対地速度 30 km/h だけ</strong>だったことです。曳航機の地上滑走は 30〜42 km/h 出るので、この閾値を超えてしまいます。速度だけでは地上滑走と離陸滑走を分けられません。</li>
          <li><strong>実際に浮いたときだけ</strong>飛行を作るようにしました。滑走を始めてから60秒以内に対地20mへ達したら離陸、達しなければ地上滑走です。記録される離陸時刻は、これまでどおり<strong>滑走を始めた時刻</strong>です。</li>
          <li>実測で余裕を確認しました。離陸滑走は最高 92〜106 km/h に達し、対地20mまでウィンチ4〜5秒・曳航16〜25秒です。地上滑走は最高でも 42 km/h で、いつまでも浮きません。</li>
        </ul>
      </Card>

      <Card title="進入中の機体が「地上」に表示される問題を修正しました">
        <ul className="list-disc ml-5 space-y-1 text-sm" style={{ color: "var(--color-text-secondary)" }}>
          <li>着陸進入中でまだ飛んでいる機体が、機体一覧で<strong>「地上」へ移ってしまう</strong>問題がありました。飛行ログは正しく「飛行中」のままなので、画面の中で表示が食い違っていました。</li>
          <li>原因は、一覧の振り分けが<strong>海抜100m未満を地上</strong>としていて、滑空場の標高を足していなかったことです。標高23mのたきかわでは<strong>対地77m</strong>——まだファイナルの途中——で地上扱いになっていました。</li>
          <li><strong>標高100mを超える滑空場では、全機がずっと地上扱い</strong>になります。こちらのほうが影響は深刻です。</li>
          <li>振り分けを<strong>サーバ側の離着陸判定</strong>に合わせました。飛行ログと機体一覧が必ず一致します。画面側で高度の閾値を持たなくなったので、同じずれは起きません。</li>
          <li>低高度の色分け・滑空経路の警告・信号消失の判定も、同じく標高を足すよう揃えました。</li>
        </ul>
      </Card>

      <Card title="ウィンチ発航の離脱を検知できるようにしました">
        <ul className="list-disc ml-5 space-y-1 text-sm" style={{ color: "var(--color-text-secondary)" }}>
          <li>これまでウィンチ発航は<strong>離脱高度が空欄のまま</strong>になっていました。判定が「索が外れたあとの減速」を見ていたためです。</li>
          <li>減速は曳航のかたちです。曳航機に引かれていた機体は索が外れると自分の速度まで落ちますが、<strong>ウィンチは逆に機首を下げて加速します</strong>。そのため条件が一度も成立しませんでした。</li>
          <li>ウィンチは<strong>上昇率の崩れ</strong>で取るようにしました。離陸直後から 7 m/s 以上の上昇が5秒続いたらウィンチ発航とみなし、上昇が 2 m/s 以下に落ちた瞬間を離脱とします。速度は見ません。</li>
          <li>たきかわの実測（2026-09-12）で検証しました。発航は 8〜18.4 m/s の上昇が35秒続き、最後の2秒で 8.0 → 5.4 → 0.5 と崩れます。同日のウィンチ発航2本を、それぞれ <strong>離陸38秒後・対地459m</strong> と <strong>離陸40秒後・対地447m</strong> で捉えられました。</li>
          <li>同じ日の曳航機・被曳航機あわせて6機は、7 m/s の上昇が<strong>1秒も続きませんでした</strong>（引き起こしで 6 m/s台の単発が出るだけ）。誤検知はゼロです。曳航とウィンチの境目は十分に広く取れています。</li>
          <li>その後の実運用で<strong>ウィンチ発航6便</strong>まで検証を広げ、すべて<strong>誤差0m・遅れ0秒</strong>でした。ウィンチは場内の低高度で完結するため受信が途切れず、最も確実に取れます。</li>
        </ul>
      </Card>

      <Card title="グライダーの離脱高度を、曳航機の値から補えるようにしました">
        <ul className="list-disc ml-5 space-y-1 text-sm" style={{ color: "var(--color-text-secondary)" }}>
          <li>曳航機の離脱は「最高高度からの降下」で確実に取れますが、グライダー側は減速を見ているため、<strong>上空で受信が飛ぶと取りこぼす</strong>ことがありました。</li>
          <li>同じ索でつながっていた曳航機とグライダーを見分け、グライダー側で離脱を検知できなかったときに<strong>曳航機の離脱高度を写す</strong>ようにしました。索長は 50〜60m なので、実用上は同じ高度です。</li>
          <li>ペアの判定は、<strong>60秒以内の離陸</strong>に加えて、<strong>水平200m・垂直100m以内で並んで上がったことを3回以上確認</strong>できたときだけ成立します。たまたま同時に飛んだだけの機体は組になりません。</li>
          <li><strong>ウィンチ発航は混ざりません。</strong>上昇率 6 m/s を超える機体は索で曳かれていないとみなします。曳航は 2〜4 m/s、ウィンチ発航は 8〜15 m/s ではっきり差が出ます。同じ滑走路から同時に出ても区別できます。</li>
          <li>自分で測れた値のほうが確かなので、曳航機の離脱から<strong>2分待って</strong>から、まだ空欄のときだけ写します。曳航機だけが飛んだ場合は、相手がいないので何も起きません。</li>
          <li>写した値には飛行ログで<strong>※</strong>が付きます。手で入力し直すと※は消えます。</li>
          <li>実運用データで精度を測りました。曳航機の記録値とグライダーの実際の離脱高度の差は <strong>+1m と -1m</strong>、遅れは4〜6秒でした。索長 50〜60m ぶんの差は実用上あらわれません。</li>
          <li>この方式が強いのは、<strong>ペアが離陸直後の場内至近で確定する</strong>からです。上空では受信が頻繁に途切れ（実測で最長479秒）、離脱の瞬間を受信できているとは限りません。一度組を確定しておけば、その後どれだけ受信が飛んでも高度を写せます。</li>
        </ul>
      </Card>

      {/* v1.2.1 */}
      <div className="flex items-center gap-3 mb-2">
        <span className="text-base font-bold" style={{ color: "var(--color-accent)" }}>v1.2.1</span>
        <span className="text-sm" style={{ color: "var(--color-text-secondary)" }}>2026-09-11</span>
      </div>

      <Card title="「利用状況の記録（UX分析）」を廃止しました">
        <ul className="list-disc ml-5 space-y-1 text-sm" style={{ color: "var(--color-text-secondary)" }}>
          <li><strong>設定画面の「利用状況の記録（UX分析）」を廃止</strong>しました。ポインター操作の記録は行いません。設定画面から項目そのものが無くなります。</li>
          <li>本機に残っている記録データは、<strong>アップデート時に自動で削除</strong>します。記録ファイル以外には触れません。</li>
          <li>リリースノートの記述を見直し、<strong>改修内容の説明を簡潔</strong>にしました。</li>
        </ul>
      </Card>

      {/* v1.2.0 */}
      <div className="flex items-center gap-3 mb-2">
        <span className="text-base font-bold" style={{ color: "var(--color-accent)" }}>v1.2.0</span>
        <span className="text-sm" style={{ color: "var(--color-text-secondary)" }}>2026-09-11</span>
      </div>

      <Card title="ADS-B設定の脆弱性を改修しました（要アップデート）">
        <ul className="list-disc ml-5 space-y-1 text-sm" style={{ color: "var(--color-text-secondary)" }}>
          <li><strong>ADS-B設定の脆弱性を改修しました。</strong> 受信機と同じネットワークから悪用されるおそれがあるため、<strong>速やかなアップデートを推奨します。</strong></li>
          <li>あわせて設定値の取り扱い全体を見直し、同種の問題が起きない作りに統一しました。</li>
          <li>ADS-BのURL欄は、<strong>使用できる文字を限定</strong>しました。空白や引用符などを含むURLは保存できません。</li>
          <li>IGCファイルの<strong>アップロードと削除に管理者ログインが必要</strong>になりました。一覧の表示はこれまでどおりログイン不要です。</li>
          <li>IGCファイルは<strong>1ファイル10MBまで</strong>になりました。</li>
        </ul>
      </Card>

      {/* v1.1.53 */}
      <div className="flex items-center gap-3 mb-2">
        <span className="text-base font-bold" style={{ color: "var(--color-accent)" }}>v1.1.53</span>
        <span className="text-sm" style={{ color: "var(--color-text-secondary)" }}>2026-09-11</span>
      </div>

      <Card title="フライトログを遡ると末尾へ引き戻される問題を修正">
        <ul className="list-disc ml-5 space-y-1 text-sm" style={{ color: "var(--color-text-secondary)" }}>
          <li>フライトログは3秒ごとに取り直しており、そのたびに<strong>無条件で末尾までスクロール</strong>していました。過去の記録を見ようと上へ戻しても、数秒で最後の行へ引き戻されて読めませんでした。</li>
          <li><strong>末尾を表示しているときだけ追従</strong>するようにしました。上へ遡っている間は動きません。末尾まで戻せば、新しい飛行への追従が再開します。</li>
          <li>あわせて、取得した記録の中身が前回と同じなら表示を作り直さないようにしました。3秒ごとの無駄な描き直しがなくなります。</li>
        </ul>
      </Card>

      {/* v1.1.52 */}
      <div className="flex items-center gap-3 mb-2">
        <span className="text-base font-bold" style={{ color: "var(--color-accent)" }}>v1.1.52</span>
        <span className="text-sm" style={{ color: "var(--color-text-secondary)" }}>2026-09-11</span>
      </div>

      <Card title="OGN設定を保存しても書き換わらない問題を修正">
        <ul className="list-disc ml-5 space-y-1 text-sm" style={{ color: "var(--color-text-secondary)" }}>
          <li>OGN設定の保存は、設定ファイルの書き込みに失敗しても<strong>その失敗を捨てて「保存しました」と表示</strong>していました。アンテナ設置位置を変えても地図上のアンテナが動かないのに、画面には成功と出る状態でした。</li>
          <li>書き込み後に<strong>ファイルを読み戻し、値が一致したときだけ成功</strong>と表示するようにしました。一致しない場合は、どのファイルでどう失敗したかを画面に出します。</li>
          <li><strong>「保存内容を確認」ボタン</strong>を追加しました。保存せずに、設定ファイル・再インストール用の設定・<strong>受信機が実際に使っている値</strong>を並べて比べられます。所有者とパーミッションも表示するので、書けない理由が分かります。</li>
          <li>書き込み方法を3段構えにしました。そのまま書く → 同じディレクトリに作って差し替える → sudo で置く、の順に試し、全部だめならその理由をまとめて表示します。</li>
          <li><code>/boot/rtlsdr-ogn.conf</code> が<strong>正本</strong>です。受信機は起動のたびにこれを <code>/home/pi</code> へ複製するため、正本に書けていなければ再起動で元に戻ります。正本に書けなかった場合は<strong>受信機を再起動しません</strong>（元の設定で動き続けるほうが安全なため）。</li>
          <li>受信機の再起動は init.d / service / systemctl の順に試します。イメージによって起動の仕組みが違うためです。</li>
          <li><code>/boot/OGN-receiver.conf</code> の書き換えで、コメントアウトされた行や空白入りの行が<strong>黙って無視される</strong>問題も直しました。項目が無ければ追記します。</li>
        </ul>
      </Card>

      {/* v1.1.51 */}
      <div className="flex items-center gap-3 mb-2">
        <span className="text-base font-bold" style={{ color: "var(--color-accent)" }}>v1.1.51</span>
        <span className="text-sm" style={{ color: "var(--color-text-secondary)" }}>2026-09-11</span>
      </div>

      <Card title="着陸を取りこぼして「飛行中」のまま残る問題を修正">
        <ul className="list-disc ml-5 space-y-1 text-sm" style={{ color: "var(--color-text-secondary)" }}>
          <li>これまでの着陸判定は<strong>「止まったところを受信できたとき」だけ</strong>でした。滑走路上は電波が届きにくく、曳航機は止まらずに次の索へ戻ることもあるため、接地したのに記録が「飛行中」のまま残ることがありました。</li>
          <li><strong>低空・低速が続いたこと</strong>でも接地とみなすようにしました（対地50m未満・50km/h未満が8秒続いたら着陸）。進入中の機体は低空にいる時間が短く、対地速度も滑走中より速いので、誤って着陸にはなりません。</li>
          <li><strong>受信が途切れた場合の後始末</strong>を追加しました。最後に受信できた位置が飛行場から3km以内・対地100m未満なら、そこで降りたとみなし、<strong>最後に受信できた時刻</strong>を着陸時刻にします。上空で受信が途切れただけの場合は何もしません（遠くを飛び続けて受信圏外にいるだけのことがあるため）。</li>
          <li><strong>同じ機体が次に離陸したら、前の飛行は着陸済みとして閉じます</strong>。着陸時刻は分からないので<strong>空欄</strong>にします。そのまま手で入力できます。</li>
          <li>地上にいる機体に「飛行中」の記録が残っている場合も同じく空欄で閉じます。飛行の途中でサービスが起動し直された場合に残っていたものです。</li>
          <li>高く上がらなかった飛行（低い場周、離陸中止）でも、離陸を観測できていれば着陸を記録します。</li>
          <li>ステータス画面の「飛行中」の数は、<strong>本当に飛んでいる機体だけ</strong>を数えます（着陸時刻が空欄のものは着陸済みとして扱います）。</li>
        </ul>
      </Card>

      {/* v1.1.50 */}
      <div className="flex items-center gap-3 mb-2">
        <span className="text-base font-bold" style={{ color: "var(--color-accent)" }}>v1.1.50</span>
        <span className="text-sm" style={{ color: "var(--color-text-secondary)" }}>2026-09-11</span>
      </div>

      <Card title="存在しない機体が1機だけ出現する問題を修正">
        <ul className="list-disc ml-5 space-y-1 text-sm" style={{ color: "var(--color-text-secondary)" }}>
          <li>復号エラーは座標だけでなく<strong>機体IDそのものも壊します</strong>。1ビット化けると別の機体として扱われ、実在しない機体が見当違いの場所に1機出現します（例: FLRDB0727 が FLRFB0727 になる）。</li>
          <li>v1.1.49 の飛躍判定では防げませんでした。壊れたIDは「初めて見る機体」なので、比べる直前の位置が無いためです。</li>
          <li>本物の機体は1秒ごとに電波を出し続けるので受信パケット数がすぐ増えますが、壊れたIDは<strong>1のまま増えません</strong>。実測でも幽霊は全て1、本物は22〜60でした。<strong>2パケット以上受信するまで表示しない</strong>ようにしました。</li>
          <li>本物の機体が遅れて出るのは1秒程度です。1パケットだけの機体は位置の確からしさも担保できないため、出さないほうが安全と判断しました。</li>
          <li>この幽霊は機体データベースにも自動登録されていました。今後は登録されません。</li>
        </ul>
      </Card>

      {/* v1.1.49 */}
      <div className="flex items-center gap-3 mb-2">
        <span className="text-base font-bold" style={{ color: "var(--color-accent)" }}>v1.1.49</span>
        <span className="text-sm" style={{ color: "var(--color-text-secondary)" }}>2026-09-11</span>
      </div>

      <Card title="復号エラーで機体がとんでもない場所へ飛ぶ問題を修正">
        <ul className="list-disc ml-5 space-y-1 text-sm" style={{ color: "var(--color-text-secondary)" }}>
          <li>受信が弱くなるとビット誤りを訂正しきれず、<strong>座標や高度が壊れた位置</strong>が出ることがあります。そのまま地図に出すと機体が突然ありえない場所・高度へ飛び、航跡も飛行記録も壊れます。</li>
          <li>物理的にありえない位置を受け付けないようにしました。<strong>座標・高度・距離が範囲外</strong>のものは受信機側で捨てます。さらに<strong>直前の位置からの見かけの速度</strong>が水平540km/h・垂直40m/sを超えるものも捨てます。</li>
          <li>ブラウザ側でも同じ判定を行い、<strong>マーカーを動かしません</strong>。航跡も飛行記録も汚れません。</li>
          <li>間隔が5分以上あいた位置は、動いたのか壊れたのか判断できないため通します。連続5回弾いた場合は基準側が怪しいので取り直し、機体が止まったままにならないようにしています。</li>
          <li>実運用の受信データ9410点で誤検出がないことを確認しました。</li>
        </ul>
      </Card>

      {/* v1.1.48 */}
      <div className="flex items-center gap-3 mb-2">
        <span className="text-base font-bold" style={{ color: "var(--color-accent)" }}>v1.1.48</span>
        <span className="text-sm" style={{ color: "var(--color-text-secondary)" }}>2026-09-11</span>
      </div>

      <Card title="受信機を再起動すると当日の飛行記録が消える問題を修正">
        <ul className="list-disc ml-5 space-y-1 text-sm" style={{ color: "var(--color-text-secondary)" }}>
          <li>v1.1.46 で飛行記録を受信機側のメモリへ移しましたが、受信機を再起動すると記録が空になり、<strong>ブラウザ側の控えまで空で上書き</strong>されていました。控えが唯一の受け皿なので、当日ぶんが完全に失われます。</li>
          <li>控えからの復元が<strong>ページを開いた瞬間しか働かない</strong>のも原因でした。画面を開いたまま受信機を再起動すると復元の機会がありません。</li>
          <li>記録の取得のたびに、サーバが空なら控えから戻すようにしました。空の内容で控えを潰すこともありません。<strong>画面を開いたままでも復旧します。</strong></li>
          <li>件数が減っただけの場合は戻しません。利用者が消した行が復活しないようにするためです。</li>
        </ul>
      </Card>

      {/* v1.1.47 */}
      <div className="flex items-center gap-3 mb-2">
        <span className="text-base font-bold" style={{ color: "var(--color-accent)" }}>v1.1.47</span>
        <span className="text-sm" style={{ color: "var(--color-text-secondary)" }}>2026-09-11</span>
      </div>

      <Card title="固定化すると何が消えるかを明記しました">
        <ul className="list-disc ml-5 space-y-1 text-sm" style={{ color: "var(--color-text-secondary)" }}>
          <li>機体情報は <code>/home/pi/FEELDSCOPE/aircraft-db.json</code> に保存されます。このファイルは固定化(OverlayFS)の対象なので、<strong>固定化中に登録した機体情報は再起動で消えます</strong>。</li>
          <li>マニュアルとセットアップガイドに、固定化中に残るものと残らないものを書きました。<strong>機体情報を残したい場合は固定化をOFFにしてください。</strong></li>
          <li>「固定化を有効にして再起動」を押したときの確認にも、機体情報が同じ扱いであることを出すようにしました。</li>
          <li>受信機の設定は <code>/boot</code> にあるため、固定化中でも残ります。</li>
        </ul>
      </Card>

      {/* v1.1.46 */}
      <div className="flex items-center gap-3 mb-2">
        <span className="text-base font-bold" style={{ color: "var(--color-accent)" }}>v1.1.46</span>
        <span className="text-sm" style={{ color: "var(--color-text-secondary)" }}>2026-09-11</span>
      </div>

      <Card title="飛行記録を受信機側で作るようにしました">
        <ul className="list-disc ml-5 space-y-1 text-sm" style={{ color: "var(--color-text-secondary)" }}>
          <li>これまで離着陸・離脱の判定は<strong>ブラウザ側</strong>で行っていました。そのため、ページを開いていない間は何も記録されず、複数のブラウザがそれぞれ判定して<strong>共有の記録を上書きし合って</strong>いました。</li>
          <li>判定を<strong>受信機側</strong>へ移しました。ブラウザを開いていなくても記録が残り、どの端末から見ても同じ内容になります。</li>
          <li>記録は<strong>メモリ上だけ</strong>に置き、SDカードには書きません。OverlayFS を有効にしたままでも動きます。ブラウザ側にも控えを残すので、受信機の再起動で当日ぶんが消えることもありません。</li>
          <li>記録の時刻は<strong>日本時間で固定</strong>しました。端末のタイムゾーン設定に左右されません。</li>
        </ul>
      </Card>

      <Card title="受信を始めた時点で飛んでいる機体を、離陸として記録しなくなりました">
        <ul className="list-disc ml-5 space-y-1 text-sm" style={{ color: "var(--color-text-secondary)" }}>
          <li>これまでは全機体を「地上にいる」前提で見始めていたため、<strong>上空を飛行中の機体が必ず離陸として記録</strong>されていました。ブラウザを開き直すたびに偽の記録が増えます。</li>
          <li>地上にいることを確認できた機体だけを離陸の対象にしました。飛行中に受信を始めた機体は、着陸を見届けた時点で地上に戻り、<strong>次の離陸からは正しく記録</strong>されます。</li>
        </ul>
      </Card>

      <Card title="離脱の判定を作り直しました（ウィンチ曳航にも対応）">
        <ul className="list-disc ml-5 space-y-1 text-sm" style={{ color: "var(--color-text-secondary)" }}>
          <li>従来は「右旋回8°/s超」と「1秒で10km/h減速」の同時成立だけで判定していたため、<strong>場周から12.5km離れた場所でのサーマル旋回を離脱と誤認</strong>していました。逆に本当の離脱は取り逃がしていました。</li>
          <li>離脱は「続いていた上昇が終わり、索から解放されて<strong>はっきり減速する</strong>」ところに現れます。この2つが同時に起きたときだけ離脱とするようにしました。サーマルから抜けるときは加速するので、区別がつきます。</li>
          <li>曳航機がいない<strong>ウィンチ曳航</strong>でも、急上昇のあとの急減速で離脱を取れます。</li>
          <li>たきかわの実データで検証しました。実際の離脱は 01:55:28・484m でしたが、従来は110秒遅れて別の場所を離脱と記録していました。新しい判定は 01:55:29・484m を捉えています。</li>
          <li>曳航機は従来どおり「最高高度から50m下がったら離脱」で判定します。こちらは確実に動きます。</li>
        </ul>
      </Card>

      {/* v1.1.45 */}
      <div className="flex items-center gap-3 mb-2">
        <span className="text-base font-bold" style={{ color: "var(--color-accent)" }}>v1.1.45</span>
        <span className="text-sm" style={{ color: "var(--color-text-secondary)" }}>2026-09-11</span>
      </div>

      <Card title="低い曳航のあと、その機体の離着陸が記録されなくなる問題を修正">
        <ul className="list-disc ml-5 space-y-1 text-sm" style={{ color: "var(--color-text-secondary)" }}>
          <li>着陸の判定は「一度 1500ft AGL を超えた機体」にしか立ちませんでした。<strong>1500ft に届かない曳航では着陸が記録されず</strong>、その機体は飛行中のまま残ります。</li>
          <li>飛行中のままになると状態が戻らないため、<strong>その機体の以後の離陸がすべて記録されなくなります</strong>。曳航機は1日に何十回も上がるので、低い曳航が1回あるだけでその日の残りが失われます。</li>
          <li>この判定の高度を <strong>500ft AGL</strong> に下げました。たきかわの実測では曳航の頂点が 485m AGL で、従来の 1500ft（457m）とほとんど差がなく、曳航ごとに通ったり通らなかったりする状態でした。</li>
        </ul>
      </Card>

      {/* v1.1.44 */}
      <div className="flex items-center gap-3 mb-2">
        <span className="text-base font-bold" style={{ color: "var(--color-accent)" }}>v1.1.44</span>
        <span className="text-sm" style={{ color: "var(--color-text-secondary)" }}>2026-09-11</span>
      </div>

      <Card title="航跡の修正の仕上げ">
        <ul className="list-disc ml-5 space-y-1 text-sm" style={{ color: "var(--color-text-secondary)" }}>
          <li>位置が遅れて届いたとき、表示時間を過ぎた古い点が航跡に残り続けることがある問題を直しました。</li>
          <li>v1.1.43 で直した集計行の読み取りについて、再発を防ぐ回帰テストを追加しました。</li>
        </ul>
      </Card>

      {/* v1.1.43 */}
      <div className="flex items-center gap-3 mb-2">
        <span className="text-base font-bold" style={{ color: "var(--color-accent)" }}>v1.1.43</span>
        <span className="text-sm" style={{ color: "var(--color-text-secondary)" }}>2026-09-11</span>
      </div>

      <Card title="航跡がジグザグになる・機体どうしで入れ替わる問題を修正">
        <ul className="list-disc ml-5 space-y-1 text-sm" style={{ color: "var(--color-text-secondary)" }}>
          <li>受信の弱い機体（平均SNRが10dB未満）の集計行を読み取れず、<strong>その機体の位置がリスト上ひとつ前の機体の航跡に混ざっていました</strong>。2機の座標が1本の線に交互に入るため、航跡がジグザグになり、機体どうしで航跡が入れ替わって見えます。</li>
          <li>混ざった結果として配信済みかどうかの判定も壊れ、<strong>直近60秒ぶんの位置が2秒ごとに丸ごと再送</strong>されていました。ブラウザは受け取った順に線を引くので、航跡が何度も前後に往復します。</li>
          <li>位置の時刻（HHMMSS）を秒数として解釈していた誤りを修正しました。表示時刻が正しくなり、並べ替えも正しく効きます。</li>
          <li>ブラウザ側も、航跡の点を<strong>時刻順に並べ、重複を捨て、ありえない飛躍を無視</strong>するようにしました。取りこぼしの違いで<strong>ブラウザごとに見え方が変わることがなくなります</strong>。</li>
          <li>ページを開いた直後に過去60点が一気に描かれて航跡が巻き戻る挙動も解消しました。</li>
        </ul>
      </Card>

      {/* v1.1.42 */}
      <div className="flex items-center gap-3 mb-2">
        <span className="text-base font-bold" style={{ color: "var(--color-accent)" }}>v1.1.42</span>
        <span className="text-sm" style={{ color: "var(--color-text-secondary)" }}>2026-09-08</span>
      </div>

      <Card title="リモートサポートが切れたまま戻らない問題を修正">
        <ul className="list-disc ml-5 space-y-1 text-sm" style={{ color: "var(--color-text-secondary)" }}>
          <li>サポート用サーバ側が数分以上停止すると、端末の VPN が再接続をあきらめ、<strong>リモートサポートONのまま到達不能</strong>になることがありました。実際に発生し、現地での再起動が必要になりました。</li>
          <li>監視タイマーが<strong>通信の途絶を検知</strong>するようになりました。5分以上ハンドシェイクが無ければトンネルを繋ぎ直します。再試行は10分間隔で、サーバ側が長時間落ちている間の繰り返しを抑えます。</li>
          <li>これまでは「サービスが停止している」場合しか復旧できませんでした。今回から「起動しているのに通信が無い」場合も拾います。</li>
        </ul>
      </Card>

      {/* v1.1.41 */}
      <div className="flex items-center gap-3 mb-2 mt-6">
        <span className="text-base font-bold" style={{ color: "var(--color-accent)" }}>v1.1.41</span>
        <span className="text-sm" style={{ color: "var(--color-text-secondary)" }}>2026-09-07</span>
      </div>

      <Card title="リモートサポートの3時間自動OFFを廃止">
        <ul className="list-disc ml-5 space-y-1 text-sm" style={{ color: "var(--color-text-secondary)" }}>
          <li><strong>時限を撤廃</strong>。ONにしたら<strong>自分でOFFにするまで有効</strong>なままになります（再起動しても維持）。残り時間の表示も廃止しました。</li>
          <li>ON/OFF の正本を <code>wg-quick@wg0</code> の enable 状態に一本化。systemd がそのまま再起動後も復帰させます。</li>
          <li>監視タイマーは<strong>ウォッチドッグ</strong>に変更。ONなのにトンネルが落ちていたら自動で復帰させます。</li>
          <li><strong>アップデートでリモートサポートが切れなくなりました</strong>。ONのまま更新しても接続が維持されます。</li>
        </ul>
      </Card>

      {/* v1.1.40 */}
      <div className="flex items-center gap-3 mb-2 mt-6">
        <span className="text-base font-bold" style={{ color: "var(--color-accent)" }}>v1.1.40</span>
        <span className="text-sm" style={{ color: "var(--color-text-secondary)" }}>2026-08-29</span>
      </div>

      <Card title="ログ・状態表示の脆弱性を改修しました">
        <ul className="list-disc ml-5 space-y-1 text-sm" style={{ color: "var(--color-text-secondary)" }}>
          <li><strong>ログ・状態表示の脆弱性を改修しました。</strong></li>
          <li><strong>システムログの閲覧に管理者ログインが必要</strong>になりました。</li>
          <li>状態表示のうち、内部ネットワーク構成や上流データソースURLなどは<strong>ログイン時のみ表示</strong>します（画面のステータス表示は従来どおり動作します）。</li>
        </ul>
      </Card>

      {/* v1.1.39 */}
      <div className="flex items-center gap-3 mb-2 mt-6">
        <span className="text-base font-bold" style={{ color: "var(--color-accent)" }}>v1.1.39</span>
        <span className="text-sm" style={{ color: "var(--color-text-secondary)" }}>2026-08-29</span>
      </div>

      <Card title="Wi-Fi設定ファイルが起動のたびに肥大化する問題を修正">
        <ul className="list-disc ml-5 space-y-1 text-sm" style={{ color: "var(--color-text-secondary)" }}>
          <li>OGN公式イメージの設定マネージャが、OGN受信機の起動のたびに <code>wpa_supplicant.conf</code> へWi-Fi設定を<strong>追記</strong>し続けるため、再起動を繰り返すと同じ設定が無限に積み重なっていました（実機で<strong>166個</strong>まで増殖）。</li>
          <li>重複を自動で畳む <code>feeldscope-wpa-dedupe</code> を追加し、<strong>起動時（OGN起動後）とOGN設定保存時に自動実行</strong>するようにしました。同じSSIDは最後の1個だけを残します。</li>
          <li>あわせて、<strong>GUIでWi-Fiを変更した際に <code>/boot/OGN-receiver.conf</code> 側も同期</strong>するよう修正。これまでは古いSSID・パスワードが起動のたびに復活し、意図しないアクセスポイントに接続しうる状態でした。</li>
          <li>既存の端末はアップデートを実行すると自動的に整理されます（元のファイルは <code>wpa_supplicant.conf.orig</code> として保全）。</li>
        </ul>
      </Card>

      {/* v1.1.38 */}
      <div className="flex items-center gap-3 mb-2 mt-6">
        <span className="text-base font-bold" style={{ color: "var(--color-accent)" }}>v1.1.38</span>
        <span className="text-sm" style={{ color: "var(--color-text-secondary)" }}>2026-07-12</span>
      </div>

      <Card title="フライトログをブラウザにも二重保存＋グライダーfavicon">
        <ul className="list-disc ml-5 space-y-1 text-sm" style={{ color: "var(--color-text-secondary)" }}>
          <li>フライトログを<strong>サーバのメモリと表示端末のブラウザ（ローカルストレージ）の両方に保存</strong>。サーバが再起動してメモリ上の記録が消えても、開いている端末の当日分から自動的に補完・復元するため、当日の記録が失われません。</li>
          <li>復元は<strong>重複・漏れなくマージ</strong>し、当日分（日本時間 AM 5:00 境界）のみ保持して翌日は自動破棄します。</li>
          <li>ブラウザのタブアイコン（favicon）を<strong>システムのグライダーアイコン</strong>に変更しました。</li>
        </ul>
      </Card>

      {/* v1.1.37 */}
      <div className="flex items-center gap-3 mb-2 mt-6">
        <span className="text-base font-bold" style={{ color: "var(--color-accent)" }}>v1.1.37</span>
        <span className="text-sm" style={{ color: "var(--color-text-secondary)" }}>2026-07-12</span>
      </div>

      <Card title="端末セキュリティのハードニングを自動適用">
        <ul className="list-disc ml-5 space-y-1 text-sm" style={{ color: "var(--color-text-secondary)" }}>
          <li>新規インストール（<code>feeldscope-install.sh</code>）と<strong>アップデート（<code>feeldscope-update.sh</code>）の両方で、端末のセキュリティ設定を自動適用</strong>するようにしました（冪等な <code>feeldscope-harden.sh</code>）。</li>
          <li><strong>ローカルファイアウォール(ufw)</strong>: SSH(22)・Web(80)・地図用MQTT WebSocket(9001)のみ受信許可。MQTTネイティブ(1883)やOGN内部ポートをLANから遮断。</li>
          <li><strong>SSH</strong>: root ログイン禁止・X11転送無効。公開鍵を登録済みの端末では、あわせてパスワード認証を無効化します（公開鍵での接続を推奨します）。</li>
        </ul>
      </Card>

      {/* v1.1.36 */}
      <div className="flex items-center gap-3 mb-2 mt-6">
        <span className="text-base font-bold" style={{ color: "var(--color-accent)" }}>v1.1.36</span>
        <span className="text-sm" style={{ color: "var(--color-text-secondary)" }}>2026-07-11</span>
      </div>

      <Card title="Wi-Fi・有線LAN設定の脆弱性を改修しました">
        <ul className="list-disc ml-5 space-y-1 text-sm" style={{ color: "var(--color-text-secondary)" }}>
          <li><strong>Wi-Fi設定・有線LAN設定の脆弱性を改修しました。</strong></li>
          <li>IPアドレス・サブネットマスク・ゲートウェイ・DNSは<strong>IPv4の形式を厳格に検証</strong>するようになりました。形式に合わない値は保存できません。</li>
          <li>SSIDとWi-Fiパスワードも長さを検証します（SSIDは63文字以内、パスワードは8〜63文字）。</li>
        </ul>
      </Card>

      {/* v1.1.35 */}
      <div className="flex items-center gap-3 mb-2 mt-6">
        <span className="text-base font-bold" style={{ color: "var(--color-accent)" }}>v1.1.35</span>
        <span className="text-sm" style={{ color: "var(--color-text-secondary)" }}>2026-07-11</span>
      </div>

      <Card title="管理者認証＋リモートサポートの時限化">
        <ul className="list-disc ml-5 space-y-1 text-sm" style={{ color: "var(--color-text-secondary)" }}>
          <li><strong>管理者ログインを追加</strong>。設定の<strong>閲覧は誰でも可能</strong>だが、<strong>変更には管理者ログインが必須</strong>に。初期パスワードは <code>admin</code>（設定画面上部でいつでも変更可・4文字以上）。</li>
          <li><strong>未ログイン時は設定画面のすべての入力欄・ボタンを無効化（グレーアウト）</strong>し、誤操作・不正変更を防止。ログイン後は従来どおり操作可能。</li>
          <li><strong>リモートサポートだけは無認証で操作可能</strong>。パスワードを失念しても、リモートサポートを有効化すればサポート担当がパスワードをリセットできる（復旧導線）。</li>
          <li><strong>リモートサポートを時限化</strong>。既定OFF・有効化から<strong>3時間で自動OFF</strong>。時間内は再起動してもON維持、経過または手動OFFで即遮断。残り時間を画面表示。</li>
          <li>サポート担当かどうかの判定は、CATVPN上の隔離されたネットワーク経路にもとづいて行います。</li>
        </ul>
      </Card>

      {/* v1.1.23 */}
      <div className="flex items-center gap-3 mb-2 mt-6">
        <span className="text-base font-bold" style={{ color: "var(--color-accent)" }}>v1.1.23</span>
        <span className="text-sm" style={{ color: "var(--color-text-secondary)" }}>2026-05-04</span>
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
