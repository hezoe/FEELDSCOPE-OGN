# OGN FLARM レシーバー構築記録 (日本 922.4 MHz)

## 概要

Raspberry Pi 5 と RTL-SDR Blog V4 を使用して、日本の 920 MHz ISM 帯 (ARIB STD-T108) で FLARM 信号を受信・デコードし、OGN (Open Glider Network) にアップロードする受信局を構築した。

日本の FLARM 周波数 (922.4 MHz) は OGN ソフトウェアにネイティブ対応していないため、ARM64 バイナリパッチにより対応した。

## ハードウェア構成

| 項目 | 詳細 |
|------|------|
| コンピュータ | Raspberry Pi 5 |
| OS | Raspberry Pi OS 64-bit (Debian 13 Trixie, aarch64) |
| ホスト名 | FLARM |
| SDR | RTL-SDR Blog V4 (R828D チューナー, TCXO 搭載) |
| テスト機器 | PowerFLARM (サンプル機) |

## 周波数計画

- **日本の FLARM 周波数**: 922.4 MHz (単一周波数)
- **規格**: ARIB STD-T108 (920 MHz ISM 帯: 920.5-923.5 MHz)
- **OGN ソフトウェアの問題**: Japan プランが存在しない

### OGN 既存周波数プラン

| Plan | 地域 | BaseFreq | ChanSepar | Channels |
|------|------|----------|-----------|----------|
| 1 | Europe/Africa | 868.2 MHz | 200 kHz | 2 |
| 2 | USA/Canada | 902.2 MHz | 400 kHz | 65 |
| 3 | Australia/S.America | 917.0 MHz | 400 kHz | 24 |
| 4 | New Zealand | 869.25 MHz | 200 kHz | 1 |

922.4 MHz はどのプランのチャネルグリッドにも一致しない:
- US Plan: (922.4 - 902.2) / 0.4 = **50.5** (整数でない)
- AU Plan: (922.4 - 917.0) / 0.4 = **13.5** (整数でない)

## 解決策: ARM64 バイナリパッチ

AU Plan 3 の BaseFreq を 917.0 MHz → **917.2 MHz** に変更することで、チャネル 13 が正確に 922.4 MHz に一致する:

```
917.2 + 13 × 0.4 = 922.4 MHz ✓
```

### ogn-rf v0.3.3 パッチ

| オフセット | 元の値 | パッチ後 | 命令 | 意味 |
|-----------|--------|---------|------|------|
| 0x5148 | `5289e803` | `528b9003` | `mov w3, #0x4F40` → `mov w3, #0x5C80` | 下位16bit |
| 0x5150 | `72a6d503` | `72a6d563` | `movk w3, #0x36A8` → `movk w3, #0x36AB` | 上位16bit |

### ogn-decode v0.3.3 パッチ

| オフセット | 元の値 | パッチ後 | 命令 | 意味 |
|-----------|--------|---------|------|------|
| 0x5AD4 | `5289e804` | `528b9004` | `mov w4, #0x4F40` → `mov w4, #0x5C80` | 下位16bit |
| 0x5ADC | `72a6d504` | `72a6d564` | `movk w4, #0x36A8` → `movk w4, #0x36AB` | 上位16bit |

### パッチの効果

```
元の値:  0x36A84F40 = 917,000,000 (917.0 MHz)
パッチ後: 0x36AB5C80 = 917,200,000 (917.2 MHz)
```

### パッチ適用コマンド (再現用)

```bash
# ogn-rf
printf '\x00\x90\x8b\x52' | dd of=ogn-rf bs=1 seek=$((0x5148)) conv=notrunc
printf '\x63\xd5\xa6\x72' | dd of=ogn-rf bs=1 seek=$((0x5150)) conv=notrunc

# ogn-decode
printf '\x04\x90\x8b\x52' | dd of=ogn-decode bs=1 seek=$((0x5AD4)) conv=notrunc
printf '\x64\xd5\xa6\x72' | dd of=ogn-decode bs=1 seek=$((0x5ADC)) conv=notrunc
```

> **重要**: ogn-rf と ogn-decode の両方をパッチする必要がある。片方だけだとデータストリームの不整合が発生する。

### バックアップ

- `ogn-rf.v033orig` — パッチ前の ogn-rf オリジナル
- `ogn-decode.orig` — パッチ前の ogn-decode オリジナル

## セットアップ手順

### 1. RTL-SDR ドライバ設定

DVB-T カーネルモジュールをブラックリストに追加:

```bash
# /etc/modprobe.d/blacklist-rtlsdr.conf
blacklist dvb_usb_rtl28xxu
blacklist rtl2832
blacklist rtl2832_sdr
```

USB 電力供給を確保:

```bash
# /boot/firmware/config.txt に追加
usb_max_current_enable=1
```

再起動後、`rtl_test` で RTL-SDR の認識を確認。

### 2. OGN ソフトウェアインストール

[VirusPilot/ogn-pi34](https://github.com/VirusPilot/ogn-pi34) スクリプトを使用して rtlsdr-ogn v0.3.3 をインストール。

```
/home/pi/rtlsdr-ogn/
├── ogn-rf          # パッチ済みバイナリ
├── ogn-decode      # パッチ済みバイナリ
├── ogn-rf.v033orig # オリジナルバックアップ
├── ogn-decode.orig # オリジナルバックアップ
├── FLARM.conf      # 受信局設定
├── rtlsdr-ogn      # 起動スクリプト (procServ)
└── rtlsdr-ogn.conf # procServ 設定
```

### 3. 設定ファイル

#### FLARM.conf

```
RF:
{
  FreqPlan = 3;            # AU Plan (パッチ済み: BaseFreq 917.2 MHz)
  Device   = 0;
  FreqCorr = 0;            # RTL-SDR Blog V4 は TCXO 搭載、補正不要
  SampleRate = 2.0;        # [MHz]

  GSM:
  { CenterFreq  =    0; Gain = 25.0; };

  OGN:
  { CenterFreq = 922.4; Gain = 40.0; };
};

Demodulator:
{
  ScanMargin = 30.0;       # [kHz] 広めのマージン
  DetectSNR  =  3.0;       # [dB]
};

Position:
{
  Latitude   =   +35.7163; # [deg]
  Longitude  =  +139.7516; # [deg]
  Altitude   =         30; # [m] AMSL
};

APRS:
{
  Call = "TestJP";          # 仮コールサイン (要変更)
};

HTTP:
{
  Port = 8082;
};
```

#### rtlsdr-ogn.conf (procServ)

```
50000  pi /home/pi/rtlsdr-ogn    ./ogn-rf     FLARM.conf
50001  pi /home/pi/rtlsdr-ogn    ./ogn-decode FLARM.conf
```

### 4. systemd サービス

```bash
sudo cp /home/pi/ogn-pi34/rtlsdr-ogn.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable rtlsdr-ogn
sudo systemctl start rtlsdr-ogn
```

自動起動が有効化されている。

## モニタリング

| URL | 内容 |
|-----|------|
| `http://localhost:8082` | ogn-rf ステータス (RF 受信状況) |
| `http://localhost:8083` | ogn-decode ステータス (デコード状況) |
| `http://localhost:8083/aircraft-list.txt` | 受信した航空機リスト (リアルタイム) |
| `telnet localhost 50000` | ogn-rf コンソール |
| `telnet localhost 50001` | ogn-decode コンソール |

### OGN ネットワーク確認

- OGN ライブマップ: http://live.glidernet.org/
- APRS フィード: aprs.glidernet.org
- レイテンシ: 数秒〜十数秒程度
- 更新頻度: 1-3 秒間隔

## 受信確認結果

- 922.4 MHz で FLARM 信号の受信を確認 (スペクトラム解析)
- PowerFLARM (FLRDB0253) のデコードに成功
- デコードデータ: 位置、高度、速度、SNR、周波数オフセット、ビットエラー
- OGN ネットワーク (aprs.glidernet.org) へのアップロードを確認

## トラブルシューティング記録

### 問題1: RTL-SDR が認識されない
- **原因**: DVB-T カーネルモジュールが先にデバイスを掴む
- **解決**: modprobe ブラックリスト追加 + 再起動

### 問題2: ogn-rf がバックグラウンドで終了する
- **原因**: stdin の EOF で終了
- **解決**: procServ で擬似端末を維持

### 問題3: フレーム検出されるがデコード数が 0
- **原因**: 922.4 MHz が AU Plan のチャネルグリッドに乗らない (13.5 チャネル目)
- **解決**: BaseFreq を 917.0→917.2 MHz にバイナリパッチ

### 問題4: ogn-decode で -inf ノイズ
- **原因**: ogn-rf のみパッチして ogn-decode 未パッチ (データストリーム不整合)
- **解決**: 両方のバイナリに同一パッチを適用

### 問題5: ogn-rf v0.2.6 ソースビルドが ogn-decode v0.3.3 と非互換
- **原因**: バージョン間でプロセス間通信の形式が異なる
- **解決**: ソースビルドを断念し、v0.3.3 バイナリパッチに切り替え

## 今後の課題

1. **APRS コールサイン変更**: "TestJP" → 正式名称 (FLARM 社との調整後)
2. **フィールドテスト**: 実際の飛行中 FLARM 搭載機での受信テスト
3. **FLARM 社との調整**: 日本向け周波数仕様の正式決定
4. **OGN 開発者への提案**: Japan 周波数プランの公式サポート追加 (調整完了後)
5. **ソフトウェア更新時**: v0.3.3 以降へのアップデート時にパッチ再適用が必要

## ソースコード参考: freqplan.h への Japan Plan 追加案

将来的に OGN ソフトウェアに正式サポートされる場合の Plan 5 定義:

```cpp
else if(Plan==5) { BaseFreq=920600000; ChanSepar=200000; Channels=15; } // Japan (ARIB STD-T108)
```

座標判定:
```cpp
if( (Longitude>=(122*600000)) && (Longitude<=(146*600000))
 && (Latitude>=(24*600000))  && (Latitude<=(46*600000)) ) return 5; // Japan
```

---

*作成日: 2026-03-13*
*ソフトウェア: rtlsdr-ogn v0.3.3 (ogn-rf + ogn-decode)*
*設置場所: 東京エリア (35.7163°N, 139.7516°E, 30m AMSL)*
