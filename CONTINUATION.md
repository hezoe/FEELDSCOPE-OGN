# FEELDSCOPE-OGN 作業継続メモ

## 現在の状態 (2026-04-09)

### 完了した作業

- OGN公式イメージ (seb-ogn-rpi-image) を RPi4 に書き込み済み
- 受信機 **RJTTTK001** として OGN ネットワークに接続・稼働中
- FEELDSCOPE を手動インストールし、Web UI (ポート80) で FLARM + ADS-B 受信を確認済み
- GitHub リポジトリ公開済み: https://github.com/hezoe/FEELDSCOPE-OGN
- **ADS-B受信問題を修正**: adsb-poller/ogn-mqtt 再起動で Receiver ID (`RJTTTK001`) 統一、古い `TestJP` retained メッセージをクリア
- **HTMLセットアップマニュアル作成**: `setup-guide.html` (OGNイメージ→OverlayFS解除→パーティション拡張→FEELDSCOPE導入)
- **feeldscope-install.sh 改修完了**:
  - `/boot/rtlsdr-ogn.conf` 自動生成 (HTTP���クション追記 + config-managerバイパス) + OGN再起動 (Step 5/8)
  - 最終出力URLポート修正 (3000→80)
  - ビルドコマンドを `npm run build` に統一
  - 全体を 8ステップ構成に変更
- **package.json**: `build` スクリプトを `next build --webpack` に修正済み
- **FlightMap.tsx**: `DEFAULT_RECEIVER_ID` ハードコード → `detectReceiverId()` で `/api/system` から動的取得に変更済み
- RPi上でリビルド・デプロイ・動作確認済み (API が `receiver_id: RJTTTK001` を返すことを確認)

### RPi の現在の状態

| 項目 | 値 |
|------|-----|
| IP | 192.168.190.132 (Wi-Fi) |
| SSH | `ssh pi@192.168.190.132` (鍵認証 + パスワード: 12qwaszx) |
| OverlayFS | **無効** (変更が永続化される状態) |
| Web UI | http://192.168.190.132/ |
| OGN 受信機名 | RJTTTK001 |
| FLARM 受信 | ICA84055F (JA01EZ) 受信中 |
| ADS-B 受信 | adsb-poller 稼働中 (tar1090 @ 192.168.190.148 から 10機前後) |

### 稼働中のサービス

| サービス | 状態 | 備考 |
|---------|------|------|
| rtlsdr-ogn (init.d) | 稼��中 | ogn-rf + ogn-decode (procServ), HTTP 8082/8083 |
| mosquitto | 稼働中 | MQTT:1883, WebSocket:9001 |
| ogn-mqtt | 稼働中 | FLARM→MQTT, Receiver ID=RJTTTK001 自動検出 |
| feeldscope-webapp | 稼働中 | Next.js ポート80, リビルド済み |
| adsb-poller | 稼働中 | Receiver ID=RJTTTK001, 3秒間隔 |
| igc-simulator | 未起動 | ogn-mqtt と排他 |

### ローカルの未コミット変更

以下のファイルが変更済みだが **未commit・未push**:
- `setup-guide.html` (新規) — HTMLセットアップマニュアル
- `feeldscope-install.sh` — rtlsdr-ogn.conf自動生成追加、8ステップ化、ポート修正
- `webapp/package.json` — build スクリプト `next build --webpack`
- `webapp/src/components/FlightMap.tsx` — 動的 Receiver ID 取得
- `webapp/src/lib/mqtt-config.ts` — 変更なし (detectReceiverId は既存)

---

## 残作業

### 1. Git commit & push

ローカルの変更を commit して GitHub に push する。

### 2. feeldscope-update.sh の実機テスト

push 後、RPi 上で実行してアップデートフローを検証:
```bash
cd /home/pi/FEELDSCOPE-OGN
sudo bash feeldscope-update.sh
```
- git pull → ファイル更新 → リビルド → サービス再起動の流れを確認
- adsb-config.json が保持されることを確認

### 3. OverlayFS 再有効化 → フルリブートテスト

```bash
sudo overlayctl enable
sudo reboot
```
- 全サービスが自動起動することを確認
- ogn-mqtt が ogn-decode (port 8083) に接続できることを確認 (起動順序の問題)
- Web UI でFLARM/ADS-Bデータが表示されることを確認

### 4. フレッシュインストール検証 (最終確認)

OGN公式イメージを新規書き込みして `feeldscope-install.sh` のみで全て動くかを検証:
```bash
sudo overlayctl disable && sudo reboot
sudo raspi-config --expand-rootfs && sudo reboot
git clone https://github.com/hezoe/FEELDSCOPE-OGN
cd FEELDSCOPE-OGN
sudo bash feeldscope-install.sh
```

### 5. その他の改善 (優先度低)

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
