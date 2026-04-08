# FEELDSCOPE-OGN 作業継続メモ

## 現在の状態 (2026-04-09)

### 完了した作業

- OGN公式イメージ (seb-ogn-rpi-image) を RPi4 に書き込み済み
- 受信機 **RJTTTK001** として OGN ネットワークに接続・稼働中
- FEELDSCOPE を手動インストールし、Web UI (ポート80) で FLARM 受信を確認済み
- GitHub リポジトリ公開済み: https://github.com/hezoe/FEELDSCOPE-OGN

### RPi の現在の状態

| 項目 | 値 |
|------|-----|
| IP | 192.168.190.132 (Wi-Fi) |
| SSH | `ssh pi@192.168.190.132` (鍵認証 + パスワード: 12qwaszx) |
| OverlayFS | **無効** (変更が永続化される状態) |
| Web UI | http://192.168.190.132/ |
| OGN 受信機名 | RJTTTK001 |
| FLARM 受信確認 | ICA84055F (JA01EZ) を受信済み |

### 稼働中のサービス

| サービス | 状態 | 備考 |
|---------|------|------|
| rtlsdr-ogn (init.d) | 稼働中 | ogn-rf + ogn-decode (procServ) |
| mosquitto | 稼働中 | MQTT:1883, WebSocket:9001 |
| ogn-mqtt | 稼働中 | FLARM→MQTT (receiver_id 自動検出) |
| feeldscope-webapp | 稼働中 | Next.js ポート80 |
| adsb-poller | 未起動 | 必要時に `sudo systemctl enable --now adsb-poller` |
| igc-simulator | 未起動 | ogn-mqtt と排他 |

---

## 残作業

### 1. インストーラーの完成

`feeldscope-install.sh` に以下を追加する必要あり:

- **`/boot/rtlsdr-ogn.conf` の自動生成**: OGN config-manager が生成する設定に HTTP セクションがないため、FEELDSCOPE 用に HTTP ポート (8082/8083) を含む設定を `/boot/rtlsdr-ogn.conf` に配置する必要がある。現在は手動で作成した。
  - config-manager は `/boot/rtlsdr-ogn.conf` が存在すれば自動生成をスキップする仕組み
  - インストーラーで現在の `/home/pi/rtlsdr-ogn.conf` を読み取り、HTTP セクションを追記して `/boot/rtlsdr-ogn.conf` に保存する処理が必要

- **OGN サービス再起動の組み込み**: HTTP ポート設定後に `sudo service rtlsdr-ogn restart` が必要

- **webapp ビルドコマンドの修正**: `npm run build` → `npx next build --webpack` に変更済みだが、`package.json` の `build` スクリプト自体を `next build --webpack` にする方がクリーン

### 2. OverlayFS 再有効化

本番運用時は OverlayFS を有効にしてSDカードを保護する:
```bash
sudo /usr/sbin/overlayctl enable
sudo reboot
```

**注意**: OverlayFS 有効化後は `/home/pi/FEELDSCOPE/` への書き込みが再起動で消える。アップデート時は disable → update → enable の手順が必要。

### 3. 再起動テスト

OverlayFS 有効化後に RPi を再起動し、全サービスが自動起動することを確認する:
- rtlsdr-ogn (init.d → 起動時に config-manager → バイナリDL → procServ)
- mosquitto (systemd)
- ogn-mqtt (systemd, After=rtlsdr-ogn)
- feeldscope-webapp (systemd)

**懸念**: config-manager が毎回バイナリをDLするため起動に時間がかかる。ogn-mqtt が先に起動して ogn-decode がまだ準備できていない場合がある（現状は Restart=on-failure で対応）。

### 4. インストーラーの実機検証

現在の RPi を初期化して、`feeldscope-install.sh` のみで全て動くかを検証する:
```bash
# OGN公式イメージ書き込み後、SSH で接続して:
sudo /usr/sbin/overlayctl disable
sudo reboot
# 再起動後:
git clone https://github.com/hezoe/FEELDSCOPE-OGN
cd FEELDSCOPE-OGN
sudo bash feeldscope-install.sh
```

### 5. その他の改善

- `package.json` の `build` スクリプトを `next build --webpack` に変更
- Leaflet CSS をローカルに含める (CDN 非依存化、オフライン対応)
- `feeldscope-update.sh` の実機テスト
- webapp の DEFAULT_RECEIVER_ID を API から動的取得する FlightMap.tsx の対応確認

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
| OGN config に HTTP ポートなし | config-manager の自動生成に HTTP セクションが含まれない | `/boot/rtlsdr-ogn.conf` を手動作成して config-manager をバイパス |
| webapp サービスが起動しない | `node .../next` のシンボリックリンク実行に失敗 | `npx next start` に変更 |
| Leaflet 地図タイルが表示されない | `/leaflet.css` が public/ に存在しない | CDN (unpkg) から読み込みに変更 |
| SDカード容量不足 (99%) | OGN イメージのパーティションが 1.6GB のまま | `raspi-config --expand-rootfs` で 29GB に拡張 |

---

## ファイル配置 (RPi 上)

```
/boot/
├── OGN-receiver.conf          ← OGN 設定 (ReceiverName, 緯度経度, Wi-Fi等)
└── rtlsdr-ogn.conf            ← OGN 詳細設定 (HTTP ポート含む, config-manager バイパス)

/home/pi/
├── rtlsdr-ogn.conf            ← config-manager が生成 or /boot/ からコピー
├── rtlsdr-ogn/                ← OGN バイナリ (起動時に自動DL)
│   ├── ogn-rf
│   └── ogn-decode
├── FEELDSCOPE-OGN/            ← git clone したソースリポジトリ
│   ├── feeldscope-install.sh
│   ├── feeldscope-update.sh
│   └── ...
└── FEELDSCOPE/                ← インストーラーがデプロイした実行環境
    ├── ogn-mqtt.py
    ├── adsb-poller.py
    ├── igc-simulator.py
    ├── aircraft-db.json
    ├── testdata/
    └── webapp/                ← Next.js (ビルド済み .next/ 含む)

/etc/systemd/system/
├── ogn-mqtt.service
├── adsb-poller.service
├── igc-simulator.service
└── feeldscope-webapp.service

/etc/mosquitto/conf.d/
└── feeldscope.conf            ← MQTT:1883 + WebSocket:9001
```
