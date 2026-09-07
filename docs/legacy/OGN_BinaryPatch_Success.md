# OGN バイナリパッチによる日本 922.4 MHz 受信成功記録

## 達成したこと

日本の FLARM 周波数 922.4 MHz (ARIB STD-T108) に対応するため、OGN (Open Glider Network) の ARM64 バイナリに直接パッチを当て、ベース周波数を変更。ノード名 **TEST JP** (コールサイン `TestJP`) として OGN ネットワークへのアップロードに成功した。

---

## 背景: なぜバイナリパッチが必要だったか

OGN ソフトウェア (rtlsdr-ogn v0.3.3) には日本向け周波数プランが存在しない。既存の 4 プランのいずれも 922.4 MHz をチャネルグリッド上に持たない。

| Plan | 地域 | BaseFreq | ChanSepar | 922.4 MHz の位置 |
|------|------|----------|-----------|-----------------|
| 1 | Europe/Africa | 868.2 MHz | 200 kHz | 範囲外 |
| 2 | USA/Canada | 902.2 MHz | 400 kHz | Ch 50.5 (非整数) |
| 3 | Australia/S.America | 917.0 MHz | 400 kHz | Ch 13.5 (非整数) |
| 4 | New Zealand | 869.25 MHz | 200 kHz | 範囲外 |

チャネル番号が整数にならないため、設定ファイルの変更だけでは対応不可能。ソースコードも v0.3.3 では非公開のため、**バイナリパッチが唯一の解決策**だった。

---

## パッチ戦略

**AU Plan 3 の BaseFreq を 917.0 MHz → 917.2 MHz に +200 kHz シフト**

これにより、チャネル 13 が正確に 922.4 MHz に一致する:

```
917.2 + 13 × 0.4 = 922.4 MHz  ✓
```

### 変更する値

```
元の値:   0x36A84F40 = 917,000,000 (917.0 MHz)
パッチ後: 0x36AB5C80 = 917,200,000 (917.2 MHz)
```

---

## パッチ詳細

### ogn-rf v0.3.3 (ARM64)

AArch64 の即値ロード命令 (`mov` + `movk`) 2 箇所を書き換え。

| オフセット | 元のバイト列 | パッチ後 | ARM64 命令の変化 |
|-----------|-------------|---------|-----------------|
| `0x5148` | `52 89 e8 03` | `52 8b 90 03` | `mov w3, #0x4F40` → `mov w3, #0x5C80` |
| `0x5150` | `72 a6 d5 03` | `72 a6 d5 63` | `movk w3, #0x36A8, lsl #16` → `movk w3, #0x36AB, lsl #16` |

### ogn-decode v0.3.3 (ARM64)

同じ周波数定数がレジスタ w4 にロードされている箇所を書き換え。

| オフセット | 元のバイト列 | パッチ後 | ARM64 命令の変化 |
|-----------|-------------|---------|-----------------|
| `0x5AD4` | `52 89 e8 04` | `52 8b 90 04` | `mov w4, #0x4F40` → `mov w4, #0x5C80` |
| `0x5ADC` | `72 a6 d5 04` | `72 a6 d5 64` | `movk w4, #0x36A8, lsl #16` → `movk w4, #0x36AB, lsl #16` |

### パッチ適用コマンド

```bash
# ogn-rf パッチ
printf '\x00\x90\x8b\x52' | dd of=ogn-rf bs=1 seek=$((0x5148)) conv=notrunc
printf '\x63\xd5\xa6\x72' | dd of=ogn-rf bs=1 seek=$((0x5150)) conv=notrunc

# ogn-decode パッチ
printf '\x04\x90\x8b\x52' | dd of=ogn-decode bs=1 seek=$((0x5AD4)) conv=notrunc
printf '\x64\xd5\xa6\x72' | dd of=ogn-decode bs=1 seek=$((0x5ADC)) conv=notrunc
```

> **重要**: ogn-rf と ogn-decode の **両方** にパッチが必須。片方だけではプロセス間データストリームの不整合が発生し、デコード数が 0 になる。

---

## ハードウェア構成

| 項目 | 詳細 |
|------|------|
| コンピュータ | Raspberry Pi 5 (ARM64) |
| OS | Raspberry Pi OS 64-bit (Debian 13 Trixie, aarch64) |
| SDR ドングル | RTL-SDR Blog V4 (R828D チューナー, TCXO 搭載) |
| テスト送信機 | PowerFLARM (サンプル機, FLRDB0253) |
| 設置場所 | 東京エリア (35.7163°N, 139.7516°E, 30m AMSL) |

---

## 設定ファイル (FLARM.conf)

```
RF:
{
  FreqPlan = 3;            # AU Plan (パッチ済み: BaseFreq 917.2 MHz)
  Device   = 0;
  FreqCorr = 0;            # RTL-SDR Blog V4 は TCXO 搭載、補正不要
  SampleRate = 2.0;        # [MHz]

  OGN:
  { CenterFreq = 922.4; Gain = 40.0; };
};

Position:
{
  Latitude   =   +35.7163;
  Longitude  =  +139.7516;
  Altitude   =         30; # [m] AMSL
};

APRS:
{
  Call = "TestJP";          # OGN ノード名
};
```

---

## OGN アップロード成功の確認

### 確認手段

1. **ローカル HTTP ステータス**
   - `http://localhost:8082` — ogn-rf の RF 受信状況
   - `http://localhost:8083` — ogn-decode のデコード状況
   - `http://localhost:8083/aircraft-list.txt` — リアルタイム航空機リスト

2. **OGN ネットワーク側**
   - OGN ライブマップ: http://live.glidernet.org/ で `TestJP` 局が表示
   - APRS フィード: aprs.glidernet.org へのデータ到達を確認

### 受信・デコード確認結果

- 922.4 MHz で FLARM 信号のスペクトラムを確認
- PowerFLARM (`FLRDB0253`) のデコードに成功
- デコードデータに含まれる情報: 位置、高度、速度、SNR、周波数オフセット、ビットエラー
- OGN ネットワークへのアップロードレイテンシ: 数秒〜十数秒
- 更新頻度: 1-3 秒間隔

---

## 解決した問題と教訓

### 問題 1: チャネルグリッド不一致

922.4 MHz は AU Plan 3 のチャネル 13.5 にあたり、半チャネル分ずれていた。フレームは検出されるがデコード数が 0 という症状。BaseFreq を +200 kHz シフトするパッチで解決。

### 問題 2: ogn-decode 側の未パッチ

ogn-rf のみパッチした状態では ogn-decode のノイズフロアが `-inf` を示し、正常にデコードできなかった。両バイナリに同一の周波数定数パッチを適用して解決。

### 問題 3: バージョン不整合

ogn-rf v0.2.6 のソースからビルドした版と ogn-decode v0.3.3 のバイナリ版を組み合わせたところ、プロセス間通信の形式が異なり動作しなかった。ソースビルドを断念し、v0.3.3 バイナリパッチに統一して解決。

---

## アーキテクチャ

```
FLARM 信号 (922.4 MHz)
    │
    ▼
RTL-SDR Blog V4
    │
    ▼
ogn-rf (パッチ済み)    ← HTTP :8082 / Telnet :50000
    │ FIFO
    ▼
ogn-decode (パッチ済み) ← HTTP :8083 / Telnet :50001
    │
    ├──▶ APRS → aprs.glidernet.org (OGN ネットワーク)
    │         ノード名: TestJP
    │
    └──▶ MQTT → localhost:1883
              トピック: ogn/TestJP/*
```

---

## 成功日・環境

- **成功日**: 2026-03-13
- **ソフトウェア**: rtlsdr-ogn v0.3.3 (ARM64 バイナリパッチ適用)
- **OGN ノード名**: TestJP (TEST JP)
- **受信周波数**: 922.4 MHz (日本 ARIB STD-T108 準拠)
- **意義**: 日本初の OGN 受信局として、ネイティブ非対応の周波数をバイナリパッチで実現

---

*本記録は FEELDSCOPE プロジェクトの一環として作成*
