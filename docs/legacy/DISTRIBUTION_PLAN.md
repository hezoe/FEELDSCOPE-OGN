# FEELDSCOPE 配布・自動更新システム計画

## 前提条件

| 項目 | 内容 |
|------|------|
| ターゲット端末 | Raspberry Pi (OGN-Team) |
| アーキテクチャ | **32bit (armhf)** ※OGN-Teamが32bit限定 |
| バックエンド | Python スクリプト + OGNバイナリ + systemd サービス |
| フロントエンド | Next.js webapp |
| 現状の配布方法 | 手動コピー + 個別シェルスクリプト |

> **重要:** OGN-Teamの端末は32bitのみ対応。開発環境での32bit動作検証を完了してからリリースフローを構築すること。

---

## 全体アーキテクチャ

```
┌─────────────────────────────────────────────────┐
│  開発PC                                          │
│  FEELDSCOPE-new/ → git push → GitHub repo        │
│                          ↓                       │
│              GitHub Actions (自動ビルド/armhf)     │
│                          ↓                       │
│              GitHub Releases (tarball配布)         │
└─────────────────────────────────────────────────┘
                           ↓
        チームメンバーのRPi で1行実行:
        curl -sSL https://<user>.github.io/feeldscope/install.sh | bash

┌─────────────────────────────────────────────────┐
│  OGN-Team の RPi (32bit armhf)                   │
│  /opt/feeldscope/                                │
│    ├── webapp/          (ビルド済みNext.js)        │
│    ├── backend/         (Python + config)         │
│    ├── bin/             (OGNバイナリ 32bit)        │
│    ├── services/        (.service ファイル)        │
│    ├── .version         (現在バージョン)            │
│    └── feeldscope       (管理コマンド)             │
│                                                   │
│  $ feeldscope update    ← これだけで最新化          │
│  $ feeldscope status    ← 稼働状態確認             │
│  $ feeldscope restart   ← 再起動                  │
└─────────────────────────────────────────────────┘
```

---

## 方式比較

| 方式 | メリット | デメリット | 判定 |
|------|---------|-----------|------|
| **GitHub Releases + curl** | 汎用的、無料、1コマンド導入 | GitHub依存 | **採用** |
| git clone + git pull | シンプル | ビルドが端末側で必要、ソース丸見え | 不採用 |
| Docker | 環境分離 | RPiでハードウェア(RTL-SDR)アクセスが面倒 | 不採用 |
| APT/DEB パッケージ | Linuxネイティブ | パッケージ管理の保守が重い | 不採用 |
| rsync/scp | 最小構成 | スケールしない、手動感が強い | 不採用 |

---

## 構成要素

### 1. GitHub リポジトリ (ソース管理 + CI/CD)

- FEELDSCOPEのコードをGitHubに配置
- `main`ブランチへのpush、またはタグ付けで自動リリース発火

### 2. GitHub Actions (自動ビルド)

- `npm run build` でwebappをビルド
- Python + OGNバイナリ(32bit armhf) + ビルド済みwebapp を tarball にパッケージング
- GitHub Releases へ自動アップロード
- **32bit (armhf) 向けビルドであることを必ず確認**

### 3. インストーラースクリプト (`install.sh`)

GitHub Pages または raw.githubusercontent.com で公開。チームメンバーは以下を実行するだけ：

```bash
curl -sSL https://<user>.github.io/feeldscope/install.sh | bash
```

スクリプトが行うこと：
1. アーキテクチャ確認 (armhf / 32bit チェック)
2. 最新リリースの tarball をダウンロード
3. `/opt/feeldscope/` に展開
4. 依存パッケージのインストール (apt-get)
5. systemd サービス登録・有効化
6. 初回設定ウィザード (局名、座標など)
7. サービス起動

### 4. `feeldscope` CLI コマンド (インストール後の管理)

| コマンド | 動作 |
|---------|------|
| `feeldscope update` | GitHub Releases API で最新バージョンチェック → ダウンロード → 展開 → サービス再起動 |
| `feeldscope status` | 全 systemd サービスの稼働状態を表示 |
| `feeldscope restart` | 全サービスを再起動 |
| `feeldscope config` | 設定ファイルを編集 |
| `feeldscope version` | 現在のバージョンを表示 |
| `feeldscope logs` | ログを表示 (journalctl ラッパー) |

### 5. GitHub Pages (導入手順ページ)

- シンプルなWebページにインストール手順を掲載
- 「このコマンドを打つだけ」を明示

---

## 運用フロー

### 初回導入 (OGN-Teamメンバー)

```bash
# RPiのターミナルで1行打つだけ
curl -sSL https://<user>.github.io/feeldscope/install.sh | bash
# → 自動的に全部入る + サービス起動
```

### アップデート (OGN-Teamメンバー)

```bash
feeldscope update
# → 最新バージョンチェック → ダウンロード → サービス再起動
```

### リリース (開発者)

```bash
git tag v1.2.0 && git push --tags
# → GitHub Actions が自動ビルド → Release作成
# → チームは feeldscope update するだけ
```

---

## 32bit対応に関する作業項目

OGN-Teamの端末は32bit (armhf) のみ対応のため、リリースフロー構築前に以下を完了する必要がある：

### 検証タスク

- [ ] 32bit RPi OS 環境の準備 (実機またはエミュレーション)
- [ ] Node.js / Next.js の 32bit armhf での動作確認
- [ ] Python スクリプト群の 32bit 環境での動作確認
- [ ] OGN バイナリ (ogn-rf, gsm_scan 等) の 32bit 互換確認
- [ ] MQTT broker (Mosquitto) の 32bit インストール確認
- [ ] webapp ビルド成果物の 32bit 環境での実行確認
- [ ] メモリ使用量の確認 (32bit = アドレス空間制限)

### 注意点

- Node.js は armhf 向け公式バイナリが提供されているが、バージョンによっては非対応の場合あり
- Next.js のビルドはメモリを多く消費するため、RPi上でのビルドではなく **クロスビルドしてバイナリ配布** が望ましい
- OGN バイナリは元々 32bit RPi 用に提供されているため問題ない想定

---

## 実装順序

| 順番 | タスク | 備考 |
|------|-------|------|
| **0** | **32bit環境での動作検証** | **最優先。これが通らないとリリースフロー構築に進めない** |
| 1 | GitHub リポジトリ作成 + コード整理 | .gitignore、構成整理 |
| 2 | GitHub Actions ワークフロー作成 | armhf向けビルド + tarball作成 |
| 3 | `install.sh` 作成 | 初回インストーラー |
| 4 | `feeldscope` CLI 作成 | update/status/restart 等 |
| 5 | GitHub Pages 公開ページ | インストール手順の案内 |
| 6 | OGN-Teamメンバーでのテスト | 実環境検証 |

---

## ファイル構成 (リポジトリ)

```
FEELDSCOPE-new/
├── .github/
│   └── workflows/
│       └── release.yml          # GitHub Actions ビルド+リリース
├── webapp/                      # Next.js フロントエンド
├── backend/
│   ├── ogn-mqtt.py
│   ├── adsb-poller.py
│   └── igc-simulator.py
├── bin/                         # OGNバイナリ (32bit armhf)
├── services/                    # systemd .service ファイル
├── scripts/
│   ├── install.sh               # ワンライナーインストーラー
│   └── feeldscope               # CLI管理コマンド
├── config/
│   ├── Template.conf
│   └── adsb-config.json
├── docs/
│   └── DISTRIBUTION_PLAN.md     # 本ドキュメント
└── package.json                 # リリーススクリプト定義
```
