# FEELDSCOPE ソフトウェア仕様書

**バージョン**: 1.0.0
**更新日**: 2026-03-20
**著作権**: Copyright (c) 2026 Hiroshi Ezoe. All rights reserved.

---

## 1. 概要

FEELDSCOPE は、OGN (Open Glider Network) の FLARM データおよび ADS-B データをリアルタイムに受信・表示する滑空場向けフライトモニターシステムである。Raspberry Pi 5 上で動作し、Web ブラウザからアクセス可能なダッシュボードを提供する。

### 1.1 システム構成図

```
┌─────────────────────────────────────────────────┐
│  RF 受信層                                       │
│  FLARM 922.4 MHz → RTL-SDR → ogn-rf → ogn-decode │
│  ADS-B 1090 MHz → tar1090/dump1090 (外部機器)     │
└────────────┬───────────────────────┬──────────────┘
             │ HTTP :8083            │ HTTP aircraft.json
             ▼                      ▼
┌────────────────────┐  ┌────────────────────┐
│  ogn-mqtt.py       │  │  adsb-poller.py    │
│  FLARM → MQTT      │  │  ADS-B → MQTT      │
└────────┬───────────┘  └────────┬───────────┘
         │ MQTT                  │ MQTT
         ▼                      ▼
┌─────────────────────────────────────────────┐
│  Mosquitto MQTT Broker (:1883, WS :9001)     │
└────────────────────┬────────────────────────┘
                     │ WebSocket
                     ▼
┌─────────────────────────────────────────────┐
│  Next.js 16 Web アプリ (:3000)               │
│  ├── マップ画面 (Leaflet + MQTT.js)          │
│  ├── 設定画面                                │
│  ├── フライトログ                             │
│  ├── ヘルプ (ポップアップ)                     │
│  └── システム管理 API (/api/system)           │
└─────────────────────────────────────────────┘
```

### 1.2 技術スタック

| レイヤー | 技術 | バージョン |
|---------|------|----------|
| ハードウェア | Raspberry Pi 5 | - |
| RF 受信 | RTL-SDR Blog V4 + rtlsdr-ogn | 0.3.3 |
| MQTT ブローカー | Mosquitto | 2.x |
| バックエンド | Python 3 (ogn-mqtt / adsb-poller / igc-simulator) | 3.13+ |
| フロントエンド | Next.js + React + TypeScript | 16.1.6 / 19.2.3 |
| 地図 | Leaflet | 1.9.4 |
| リアルタイム通信 | MQTT.js (WebSocket) | 5.15.0 |
| CSS | Tailwind CSS | 4.x |

---

## 2. 機能仕様

### 2.1 マップ表示

| 項目 | 仕様 |
|------|------|
| 地図ソース | OpenStreetMap |
| 初期表示 | 滑空場設定の緯度・経度を中心、ズーム 11 |
| 滑空場マーカー | 赤色円、名前ラベル付き (永続表示) |
| HOME ボタン | 右上、クリックで初期位置に復帰 |
| ズームコントロール | 右下 |

### 2.2 FLARM 機体表示

| 項目 | 仕様 |
|------|------|
| グライダーアイコン | SVG 翼形、進行方向に回転 |
| 曳航機アイコン | SVG 曳航機形、進行方向に回転 |
| 曳航機判定 | glider_type に "HK-36", "Husky", "Pawnee", "Tow" を含む |
| ツールチップ | ラベル + 高度 + 速度 (永続表示) |
| 軌跡 (trail) | 最大 300 ポイントのポリライン |

#### 2.2.1 機体アイコン色

| 状態 | 色 | 条件 |
|------|-----|------|
| 通常 | 緑 (#2e7d32) | 高度 ≥ 1500ft AGL、パス十分 |
| 低高度 | 橙 (#e67e22) | 高度 < 1500ft AGL (地上除く) |
| 着陸進入中 | 橙 (#e67e22) | 飛行中 (phase != ground) かつ高度 < 地上判定高度 |
| パス不足 | 赤 (#d32f2f) + 点滅 | 必要滑空比 > 安全滑空比 |
| 地上 (着陸後) | 緑 (#2e7d32) | phase == ground かつ高度 < 地上判定高度 |

#### 2.2.2 判定閾値

| パラメータ | 値 | 説明 |
|-----------|-----|------|
| GROUND_ALT_M | 100 m | 地上判定高度 (AGL ではなく絶対高度) |
| LOW_ALT_FT | 1500 ft | 低高度判定 (AGL) |
| LOST_SIGNAL_SEC | 10 秒 | 通信途絶判定 |
| 安全滑空比 (デフォルト) | 15:1 | 設定画面で変更可能 (1〜100) |

### 2.3 ADS-B 機体表示

| 項目 | 仕様 |
|------|------|
| アイコン | SVG ジェット機形、進行方向に回転 |
| ADS-B 色 | 青 (#1565c0) |
| Mode-S/C 色 | 黒 (#222) |
| ラベル | フライト番号 > hex ID の優先順 |
| 位置不明機体 | サイドバーのみに高度付きで表示 |

### 2.4 サイドバー

4つのカテゴリに分類して表示:

| カテゴリ | 条件 | 背景色 |
|---------|------|--------|
| 警告 | FLARM、高度 ≥ GROUND_ALT_M、通信途絶 or パス不足 | 赤背景 + 赤点滅 |
| 上空 | FLARM、高度 ≥ GROUND_ALT_M、通信正常 & パス十分 | 低高度時: 橙背景 |
| ADS-B / Mode-S | adsb == true、高度 ≥ GROUND_ALT_M | 通常 |
| 地上 | FLARM、高度 < GROUND_ALT_M | 通常 |

### 2.5 フライトログ

| 項目 | 仕様 |
|------|------|
| 記録フィールド | #, 登録番号, 離陸時刻, 着陸時刻, 飛行時間, 離脱高度 |
| 永続化 | localStorage (`ogn-flight-log`) |
| 自動スクロール | 新規エントリ追加時に末尾にスクロール |
| 編集可能 | 離陸時刻, 着陸時刻, 離脱高度 (インライン編集) |
| 削除 | 各行にゴミ箱ボタン (確認ダイアログ付き) |

#### 2.5.1 自動検知ロジック

| イベント | 条件 |
|---------|------|
| 離陸 | 対地速度 > 30 km/h (TAKEOFF_SPEED_MS) |
| 着陸 | 過去に 1500ft AGL 超を記録 & AGL < 1500ft & 速度 < 10 km/h |
| 曳航離脱 | グライダーのみ。旋回率 > 8°/s & 速度低下 > 10 km/h & AGL > 150m |

#### 2.5.2 飛行時間表示

- 飛行中: 離陸時刻から現在時刻までの経過時間をリアルタイム更新 (毎秒)
- 着陸後: 離陸〜着陸の確定飛行時間を表示
- 形式: `HH+MM`

### 2.6 設定画面

| セクション | 設定項目 | 永続化 |
|-----------|---------|--------|
| 滑空場設定 | 名前, 緯度, 経度, 標高 | localStorage |
| データソース切替 | リアルタイム / 履歴再生 / 停止 | systemd サービス |
| 再生倍速 | 1〜20x (スライダー) | localStorage + 実行時 MQTT 反映 |
| 表示設定 | ラベル表示名, 高度単位, 速度単位, 上昇率単位, 安全滑空比 | localStorage |
| ADS-B 受信設定 | 有効/無効, URL, ポーリング間隔 | localStorage + systemd |
| IGC ファイル管理 | アップロード / 削除 | ファイルシステム |

### 2.7 ヘルプ機能

| 項目 | 説明 |
|------|------|
| 表示形式 | ポップアップモーダル (タブ切替) |
| タブ | マニュアル / リリースノート / バージョン |
| 閉じる | タイトルバー右端 × ボタン、または背景クリック |
| 配置 | ナビゲーションバーのヘルプメニューから展開 |

### 2.8 GUI デザイン方針

| 項目 | 仕様 |
|------|------|
| デザイン基準 | Windows 11 標準 GUI 準拠 |
| カラーパレット | Windows 11 システムカラー (#f3f3f3 背景, #0067c0 アクセント) |
| フォント | Segoe UI / Meiryo / Yu Gothic UI |
| メニューバー | セパレータ区切り、アンダーライン選択表示 |
| ダイアログ | タイトルバー + × ボタン (右端)、タブバー |
| テーブル | 交互行色、グレーヘッダー、セル区切り |
| 設定画面 | fieldset + legend によるグループボックス |
| リサイズ | マップ↔フライトログ (上下)、マップ↔サイドバー (左右) |

---

## 3. データフロー仕様

### 3.1 FLARM データフロー

```
PowerFLARM (922.4 MHz) → RTL-SDR → ogn-rf (FFT)
  → FIFO → ogn-decode (デコード)
  → HTTP :8083/aircraft-list.txt
  → ogn-mqtt.py (2秒ポーリング)
  → Mosquitto :1883 → WebSocket :9001
  → Web アプリ (MQTT.js) → Leaflet マップ
```

### 3.2 ADS-B データフロー

```
航空機 (1090 MHz) → ADS-B 受信機 → tar1090/dump1090
  → HTTP aircraft.json
  → adsb-poller.py (1〜30秒ポーリング)
  → Mosquitto :1883 → WebSocket :9001
  → Web アプリ (MQTT.js) → Leaflet マップ
```

### 3.3 MQTT トピック一覧

| トピック | ソース | QoS | Retain | 説明 |
|---------|--------|-----|--------|------|
| `ogn/{rid}/aircraft/{did}/position` | ogn-mqtt / adsb-poller | 0 | No | 個別機体位置 |
| `ogn/{rid}/aircraft/{did}/status` | ogn-mqtt | 1 | Yes | FLARM 機体サマリー |
| `ogn/{rid}/aircraft` | ogn-mqtt | 1 | Yes | FLARM 全機体リスト |
| `ogn/{rid}/aircraft_adsb` | adsb-poller | 1 | Yes | ADS-B 全機体リスト |
| `ogn/{rid}/status` | ogn-mqtt | 1 | Yes | レシーバーステータス |
| `ogn/{rid}/command` | Web API | 0 | No | igc-simulator 速度変更 |

---

## 4. API 仕様 (Web アプリ)

### 4.1 GET /api/system

レスポンス:

```json
{
  "mode": "realtime" | "history" | "stopped",
  "ogn_mqtt_active": boolean,
  "igc_simulator_active": boolean,
  "mosquitto_active": boolean,
  "adsb_poller_active": boolean
}
```

### 4.2 POST /api/system

| action | パラメータ | 動作 |
|--------|----------|------|
| `realtime` | - | ogn-mqtt サービス起動 |
| `history` | `speed` (1-20) | igc-simulator サービス起動/速度変更 |
| `stop` | - | ogn-mqtt + igc-simulator 停止 |
| `adsb-start` | `url`, `interval` | adsb-poller サービス起動 |
| `adsb-stop` | - | adsb-poller サービス停止 |

### 4.3 GET /api/system/igc-files

IGC ファイル一覧取得。

### 4.4 POST /api/system/igc-files

IGC ファイルアップロード (multipart/form-data)。

### 4.5 DELETE /api/system/igc-files

IGC ファイル削除 (`{ "name": "filename.igc" }`)。

---

## 5. systemd サービス一覧

| サービス名 | 説明 | 依存 |
|-----------|------|------|
| `rtlsdr-ogn` | OGN RF 受信 + デコード | - |
| `mosquitto` | MQTT ブローカー | - |
| `ogn-mqtt` | FLARM → MQTT パブリッシャー | mosquitto, rtlsdr-ogn |
| `igc-simulator` | IGC 履歴再生 | mosquitto |
| `adsb-poller` | ADS-B → MQTT ポーラー | mosquitto |

起動順序: `rtlsdr-ogn` → `mosquitto` → `ogn-mqtt` / `adsb-poller`

`ogn-mqtt` と `igc-simulator` は排他動作 (Conflicts= 設定)。
`adsb-poller` は他サービスと並行動作可能。

---

## 6. ファイル構成

```
/home/pi/rtlsdr-ogn-0.3.3/
├── ogn-mqtt.py                    # FLARM → MQTT パブリッシャー
├── igc-simulator.py               # IGC 履歴再生エンジン
├── adsb-poller.py                 # ADS-B → MQTT ポーラー
├── OGN_Receiver_Setup_Japan.md    # レシーバー構築記録
├── OGN_MQTT_API_Specification.md  # MQTT API 仕様書
├── 受信デコードMQTT.md             # 構築手順書
├── FEELDSCOPE_Specification.md    # 本仕様書
└── webapp/                        # Next.js Web アプリ
    ├── package.json
    ├── src/
    │   ├── app/
    │   │   ├── page.tsx           # マップ画面 (エントリポイント)
    │   │   ├── layout.tsx         # ルートレイアウト
    │   │   ├── globals.css        # テーマ定義 (CSS 変数)
    │   │   ├── settings/page.tsx  # 設定画面
    │   │   └── api/
    │   │       └── system/
    │   │           ├── route.ts        # システム管理 API
    │   │           └── igc-files/route.ts  # IGC ファイル API
    │   ├── components/
    │   │   ├── FlightMap.tsx      # マップ + フライトログ + サイドバー
    │   │   └── Navigation.tsx     # ナビゲーション + ヘルプポップアップ
    │   └── lib/
    │       ├── types.ts           # TypeScript 型定義
    │       ├── units.ts           # 単位変換ユーティリティ
    │       ├── UnitContext.tsx     # 表示設定 Context
    │       └── mqtt-config.ts     # MQTT 接続設定
    └── public/                    # 静的ファイル
```

---

## 7. 動作環境

| 項目 | 仕様 |
|------|------|
| プラットフォーム | Raspberry Pi 5 |
| OS | Raspberry Pi OS 64-bit (Debian 13 Trixie, aarch64) |
| FLARM 受信周波数 | 922.4 MHz (日本 ARIB STD-T108) |
| SDR | RTL-SDR Blog V4 (R828D, TCXO) |
| ブラウザ | Chrome, Firefox, Safari (モダンブラウザ) |
| ネットワーク | ローカル LAN (認証なし、TLS なし) |

---

*FEELDSCOPE v1.0.0 — Copyright (c) 2026 Hiroshi Ezoe. All rights reserved.*
