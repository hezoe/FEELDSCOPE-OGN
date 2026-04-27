# FEELDSCOPE-OGN 作業継続メモ

## 現在の状態 (2026-04-27)

### 完了した作業

- OGN公式イメージ (seb-ogn-rpi-image) を RPi4 に書き込み済み
- 受信機 **RJTTTK001** として OGN ネットワークに接続・稼働中
- FEELDSCOPE を手動インストールし、Web UI (ポート80) で FLARM + ADS-B 受信を確認済み
- GitHub リポジトリ公開済み: https://github.com/hezoe/FEELDSCOPE-OGN
- **ADS-B受信問題を修正**: adsb-poller/ogn-mqtt 再起動で Receiver ID (`RJTTTK001`) 統一、古い `TestJP` retained メッセージをクリア
- **HTMLセットアップマニュアル作成**: `setup-guide.html` (OGNイメージ→OverlayFS解除→パーティション拡張→FEELDSCOPE導入)
- **feeldscope-install.sh 改修完了**:
  - `/boot/rtlsdr-ogn.conf` 自動生成 (HTTPセクション追記 + config-managerバイパス) + OGN再起動 (Step 5/8)
  - 最終出力URLポート修正 (3000→80)
  - ビルドコマンドを `npm run build` に統一
  - 全体を 8ステップ構成に変更
- **package.json**: `build` スクリプトを `next build --webpack` に修正済み
- **FlightMap.tsx**: `DEFAULT_RECEIVER_ID` ハードコード → `detectReceiverId()` で `/api/system` から動的取得に変更済み
- RPi上でリビルド・デプロイ・動作確認済み (API が `receiver_id: RJTTTK001` を返すことを確認)
- **feeldscope-update.sh 実機テスト完了**: git pull → ファイル更新 → リビルド → サービス再起動の一連フロー動作確認済み
- **OverlayFS再有効化 + フルリブートテスト完了**: 全サービス自動起動OK、MQTT経由でFLARMデータ配信を確認
- **離脱距離機能を追加**: フライトログに離脱距離列を追加、設定画面に距離単位 (km/nm) セレクタを追加
- **フライトログテーブルのコンパクト化**: 全列左詰め、最小パディング (px-1) に統一
- **開発リポジトリ一本化**: FEELDSCOPE-OGN に一本化、FEELDSCOPE-new は参照用アーカイブ
- **v1.1.16: 機種別アイコン刷新**: IconMaker ツールで実機画像からトレースした SVG パスに全面更新
  - 滑空機: 高アスペクト比翼 (AR≈20)、前縁直線/後縁テーパー、ベジェ曲線胴体
  - 曳航機: 実機トレース (Piper Cub 系)
  - 動力機: 実機トレース
  - ヘリコプター: 実機トレース (ローター + テールロータ構成)
  - パラグライダー: 実機トレース (ラムエアキャノピー形状)

### RPi の現在の状態

| 項目 | 値 |
|------|-----|
| IP | 192.168.190.132 (Wi-Fi) |
| SSH | `ssh pi@192.168.190.132` (鍵認証 + パスワード: 12qwaszx) |
| OverlayFS | **有効** (変更は再起動で消える) |
| Web UI | http://192.168.190.132/ |
| OGN 受信機名 | RJTTTK001 |
| FLARM 受信 | ICA84055F (JA01EZ) 受信中 |
| ADS-B 受信 | adsb-poller 稼働中 (tar1090 @ 192.168.190.148 から 10機前後) |

### 稼働中のサービス

| サービス | 状態 | 備考 |
|---------|------|------|
| rtlsdr-ogn (init.d) | 稼働中 | ogn-rf + ogn-decode (procServ), HTTP 8082/8083 |
| mosquitto | 稼働中 | MQTT:1883, WebSocket:9001 |
| ogn-mqtt | 稼働中 | FLARM→MQTT, Receiver ID=RJTTTK001 自動検出 |
| feeldscope-webapp | 稼働中 | Next.js ポート80, リビルド済み |
| adsb-poller | 稼働中 | Receiver ID=RJTTTK001, 3秒間隔 |
| igc-simulator | 未起動 | ogn-mqtt と排他 |

### 検証済みフロー

- **feeldscope-update.sh**: git pull → ファイル更新 → webapp リビルド → サービス再起動 (adsb-config.json 保持確認済み)
- **OverlayFS リブート**: 無効化 → アップデート → 再有効化 → リブート → 全サービス自動起動
- **起動順序**: ogn-mqtt が ogn-decode より先に起動し Connection refused になるが、リトライで自然回復 (実用上問題なし)

---

## 残作業

### 1. フレッシュインストール検証 (最終確認)

OGN公式イメージを新規書き込みして `feeldscope-install.sh` のみで全て動くかを検証:
```bash
sudo overlayctl disable && sudo reboot
sudo raspi-config --expand-rootfs && sudo reboot
sudo apt-get update && sudo apt-get install -y git
git clone https://github.com/hezoe/FEELDSCOPE-OGN
cd FEELDSCOPE-OGN
sudo bash feeldscope-install.sh
```

### 2. その他の改善 (優先度低)

- Leaflet CSS をローカルに含める (CDN 非依存化、オフライン対応)
- setup-guide.html に手順追記 (実際のインストール検証結果を反映)

---

## インストール中に発見・解決した armhf 固有の問題

| 問題 | 原因 | 対応 |
|------|------|------|
| NodeSource が armhf 非対応 | NodeSource は amd64/arm64 のみサポート | 公式 Node.js armv7l バイナリを直接ダウンロード |
| Tailwind CSS v4 ビルド失敗 | `@tailwindcss/oxide` にネイティブ armhf バインディングなし | Tailwind v3 にダウングレード |
| Next.js Turbopack ビルド失敗 | SWC の wasm バインディングが armhf で `turbo.createProject` 未対応 | `npx next build --webpack` で webpack ビルド |
| ogn-mqtt がポジションをパースできない | v0.3.3 の `Fn:` フィールド形式が `Fn:00fop+13.83kHz` で `\S+` が kHz まで食べる | 正規表現を `\S+?` (non-greedy) に修正 |
| Receiver ID ハードコード | `TestJP` が全コンポーネントにハードコード | `/boot/OGN-receiver.conf` の `ReceiverName` から自動検出 |
| Receiver ID パースでコメント混入 | `ReceiverName="RJTTTK001" # comment` を全体取得 | `#` 以降を除去する処理追加 |
| OGN config に HTTP ポートなし | config-manager の自動生成に HTTP セクションが含まれない | インストーラーで自動追記 + `/boot/` にコピーでバイパス |
| webapp サービスが起動しない | `node .../next` のシンボリックリンク実行に失敗 | `npx next start` に変更 |
| Leaflet 地図タイルが表示されない | `/leaflet.css` が public/ に存在しない | CDN (unpkg) から読み込みに変更 |
| SDカード容量不足 (99%) | OGN イメージのパーティションが 1.6GB のまま | `raspi-config --expand-rootfs` で拡張 |
| ADS-B データが Web UI に表示されない | adsb-poller が古いコードで `TestJP` トピックに publish | サービス再起動で修正、stale retained メッセージをクリア |

---

## リリースノート (2026-04-09)

### 新機能
- **離脱距離表示**: フライトログに離脱距離列を追加。離脱検出時の航空機位置と滑空場間の水平距離を自動計算
- **距離単位設定**: 設定画面に距離単位 (km / nm) セレクタを追加
- **セットアップマニュアル**: `setup-guide.html` を追加 (OGNイメージ→FEELDSCOPE導入の全手順)

### 改善
- **フライトログUI**: 全列左詰め・最小パディングでコンパクト化
- **インストーラー**: OGN HTTP config自動生成 (Step 5/8)、出力URLポート修正、8ステップ構成
- **動的Receiver ID**: FlightMap.tsx が `/api/system` から Receiver ID を動的取得
- **ビルドコマンド統一**: `package.json` の build スクリプトに `--webpack` フラグを含める

### 検証
- feeldscope-update.sh 実機テスト完了
- OverlayFS有効状態でのフルリブートテスト完了 (全サービス自動起動)

---

## ファイル配置 (RPi 上)

```
/boot/
├── OGN-receiver.conf          ← OGN 設定 (ReceiverName, 緯度経度, Wi-Fi等)
└── rtlsdr-ogn.conf            ← OGN 詳細設定 (HTTP ポート含む, config-manager バイパス)

/home/pi/
├── rtlsdr-ogn.conf            ← /boot/ からコピー (ogn-rf/ogn-decode が参照)
├── rtlsdr-ogn/                ← OGN バイナリ (起動時に自動DL)
│   ├── ogn-rf
│   └── ogn-decode
├── FEELDSCOPE-OGN/            ← git clone したソースリポジトリ
│   ├── feeldscope-install.sh
│   ├── feeldscope-update.sh
│   ├── setup-guide.html
│   └── ...
└── FEELDSCOPE/                ← インストーラーがデプロイした実行環境
    ├── ogn-mqtt.py
    ├── adsb-poller.py
    ├── igc-simulator.py
    ├── aircraft-db.json
    ├── adsb-config.json       ← ADS-B設定 (有効, URL, interval)
    ├── testdata/
    └── webapp/                ← Next.js (ビルド済み .next/ 含む)

/etc/systemd/system/
├── ogn-mqtt.service
├── adsb-poller.service        ← + drop-in: config.conf (URL/interval override)
├── igc-simulator.service
└── feeldscope-webapp.service

/etc/mosquitto/conf.d/
└── feeldscope.conf            ← MQTT:1883 + WebSocket:9001
```
