# OGN FLARM 受信・デコード・MQTT 配信 構築手順書

**作成日**: 2026-03-13
**対象**: Raspberry Pi 5 + RTL-SDR Blog V4 による日本向け OGN FLARM レシーバー

本書はゼロから環境を再現するための全手順を記載する。

---

## 目次

1. [前提条件](#1-前提条件)
2. [RTL-SDR ドライバ設定](#2-rtl-sdr-ドライバ設定)
3. [OGN ソフトウェアインストール](#3-ogn-ソフトウェアインストール)
4. [日本向けバイナリパッチ](#4-日本向けバイナリパッチ922mhz)
5. [レシーバー設定ファイル](#5-レシーバー設定ファイル)
6. [OGN レシーバーサービス化](#6-ogn-レシーバーサービス化)
7. [MQTT ブローカー構築](#7-mqtt-ブローカー構築)
8. [MQTT パブリッシャー構築](#8-mqtt-パブリッシャー構築)
9. [MQTT パブリッシャーサービス化](#9-mqtt-パブリッシャーサービス化)
10. [動作確認](#10-動作確認)
11. [トラブルシューティング](#11-トラブルシューティング)
12. [ファイル一覧](#12-ファイル一覧)

---

## 1. 前提条件

### ハードウェア

| 項目 | 詳細 |
|------|------|
| コンピュータ | Raspberry Pi 5 |
| OS | Raspberry Pi OS 64-bit (Debian 13 Trixie, aarch64) |
| SDR | RTL-SDR Blog V4 (R828D チューナー, TCXO 搭載) |
| アンテナ | 920 MHz 帯対応アンテナ |

### ソフトウェア要件

```bash
# Python 3 (OS に同梱)
python3 --version  # 3.13+

# 必要パッケージ (手順中でインストール)
# - rtl-sdr
# - procserv
# - mosquitto, mosquitto-clients
# - python3-paho-mqtt
```

---

## 2. RTL-SDR ドライバ設定

### 2.1 DVB-T カーネルモジュールのブラックリスト

RTL-SDR を SDR として使うため、DVB-T テレビ受信ドライバを無効化する。

```bash
sudo tee /etc/modprobe.d/blacklist-rtlsdr.conf << 'EOF'
blacklist dvb_usb_rtl28xxu
blacklist rtl2832
blacklist rtl2832_sdr
EOF
```

### 2.2 USB 電力供給の確保

```bash
# /boot/firmware/config.txt に追加
echo "usb_max_current_enable=1" | sudo tee -a /boot/firmware/config.txt
```

### 2.3 再起動と確認

```bash
sudo reboot
# 再起動後:
rtl_test -t
# "Found 1 device(s)" と表示されれば成功
```

---

## 3. OGN ソフトウェアインストール

### 3.1 ogn-pi34 インストールスクリプト

```bash
cd /home/pi
git clone https://github.com/VirusPilot/ogn-pi34.git
cd ogn-pi34
sudo ./install.sh
```

これにより以下が `/home/pi/rtlsdr-ogn/` にインストールされる:

- `ogn-rf` — RF プロセッサ (v0.3.3 ARM64)
- `ogn-decode` — デコーダ (v0.3.3 ARM64)
- `rtlsdr-ogn` — 起動スクリプト (procServ 利用)
- `rtlsdr-ogn.conf` — procServ 設定
- 各種ユーティリティ

### 3.2 依存パッケージ確認

```bash
# procServ がインストールされていない場合
sudo apt-get install -y procserv rtl-sdr
```

---

## 4. 日本向けバイナリパッチ (922.4 MHz)

### 4.1 背景

日本の FLARM は 922.4 MHz (ARIB STD-T108) を使用するが、OGN ソフトウェアに日本プランは存在しない。

AU Plan 3 (BaseFreq=917.0 MHz, ChanSepar=400 kHz, 24ch) の BaseFreq を 917.2 MHz に変更すると:

```
チャネル 13 = 917.2 + 13 × 0.4 = 922.4 MHz ✓
```

### 4.2 オリジナルのバックアップ

```bash
cd /home/pi/rtlsdr-ogn
cp ogn-rf ogn-rf.v033orig
cp ogn-decode ogn-decode.orig
```

### 4.3 ogn-rf パッチ

AU Plan BaseFreq: 917,000,000 (0x36A84F40) → 917,200,000 (0x36AB5C80)

```bash
# オフセット 0x5148: mov w3, #0x4F40 → mov w3, #0x5C80
printf '\x00\x90\x8b\x52' | dd of=ogn-rf bs=1 seek=$((0x5148)) conv=notrunc

# オフセット 0x5150: movk w3, #0x36A8,lsl#16 → movk w3, #0x36AB,lsl#16
printf '\x63\xd5\xa6\x72' | dd of=ogn-rf bs=1 seek=$((0x5150)) conv=notrunc
```

### 4.4 ogn-decode パッチ

```bash
# オフセット 0x5AD4: mov w4, #0x4F40 → mov w4, #0x5C80
printf '\x04\x90\x8b\x52' | dd of=ogn-decode bs=1 seek=$((0x5AD4)) conv=notrunc

# オフセット 0x5ADC: movk w4, #0x36A8,lsl#16 → movk w4, #0x36AB,lsl#16
printf '\x64\xd5\xa6\x72' | dd of=ogn-decode bs=1 seek=$((0x5ADC)) conv=notrunc
```

### 4.5 パッチ検証

```bash
# ogn-rf の確認
xxd -s 0x5148 -l 4 ogn-rf   # 期待値: 00908b52
xxd -s 0x5150 -l 4 ogn-rf   # 期待値: 63d5a672

# ogn-decode の確認
xxd -s 0x5AD4 -l 4 ogn-decode  # 期待値: 04908b52
xxd -s 0x5ADC -l 4 ogn-decode  # 期待値: 64d5a672
```

### 4.6 パッチ詳細リファレンス

| バイナリ | オフセット | 元の値 | パッチ後 | ARM64 命令 |
|---------|-----------|--------|---------|-----------|
| ogn-rf | 0x5148 | `5289e803` | `528b9003` | `mov w3, #0x4F40` → `mov w3, #0x5C80` |
| ogn-rf | 0x5150 | `72a6d503` | `72a6d563` | `movk w3, #0x36A8,lsl#16` → `movk w3, #0x36AB,lsl#16` |
| ogn-decode | 0x5AD4 | `5289e804` | `528b9004` | `mov w4, #0x4F40` → `mov w4, #0x5C80` |
| ogn-decode | 0x5ADC | `72a6d504` | `72a6d564` | `movk w4, #0x36A8,lsl#16` → `movk w4, #0x36AB,lsl#16` |

> **重要**: ogn-rf と ogn-decode の **両方** をパッチすること。片方のみだとデータストリームの不整合が発生し、デコード不能になる。

---

## 5. レシーバー設定ファイル

### 5.1 FLARM.conf

```bash
cat > /home/pi/rtlsdr-ogn/FLARM.conf << 'EOF'
RF:
{
  FreqPlan = 3;            # AU Plan (パッチ済み: BaseFreq 917.2 MHz)
  Device   = 0;
  FreqCorr = 0;            # RTL-SDR Blog V4 は TCXO 搭載、補正不要
  SampleRate = 2.0;        # [MHz] 2MHz to capture all systems

  GSM:
  {
    CenterFreq  =    0;    # [MHz] set via gsm_scan if needed
    Gain        = 25.0;    # [dB]
  };

  OGN:
  {
    CenterFreq = 922.4;    # [MHz] Japan 920MHz band
    Gain       =  40.0;    # [dB] startup gain, auto-adjusted by AGC
  };
};

Demodulator:
{
  ScanMargin = 30.0;       # [kHz] wide margin to capture 200kHz offset from AU plan grid
  DetectSNR  =  3.0;       # [dB]
};

Position:
{
  Latitude   =   +35.7163; # [deg] ← 設置場所に変更
  Longitude  =  +139.7516; # [deg] ← 設置場所に変更
  Altitude   =         30; # [m] AMSL ← 設置場所に変更
};

APRS:
{
  Call = "TestJP";          # ← 正式コールサインに変更
};

HTTP:
{
  Port = 8082;
};
EOF
```

### 5.2 rtlsdr-ogn.conf (procServ 設定)

```bash
cat > /home/pi/rtlsdr-ogn/rtlsdr-ogn.conf << 'EOF'
#port  user     directory       command      args
50000  pi /home/pi/rtlsdr-ogn    ./ogn-rf     FLARM.conf
50001  pi /home/pi/rtlsdr-ogn    ./ogn-decode FLARM.conf
EOF
```

---

## 6. OGN レシーバーサービス化

### 6.1 systemd サービスファイル

```bash
sudo tee /etc/systemd/system/rtlsdr-ogn.service << 'EOF'
[Unit]
Description=OGN Receiver Service
After=network-online.target
Wants=network-online.target

[Service]
Type=forking
WorkingDirectory=/home/pi/rtlsdr-ogn
ExecStart=/home/pi/rtlsdr-ogn/rtlsdr-ogn start
ExecStop=/home/pi/rtlsdr-ogn/rtlsdr-ogn stop
ExecReload=/home/pi/rtlsdr-ogn/rtlsdr-ogn reload
RemainAfterExit=yes
Restart=no
SyslogIdentifier=rtlsdr-ogn

[Install]
WantedBy=multi-user.target
EOF
```

### 6.2 有効化と起動

```bash
sudo systemctl daemon-reload
sudo systemctl enable rtlsdr-ogn
sudo systemctl start rtlsdr-ogn
```

### 6.3 動作確認

```bash
# サービス状態
sudo systemctl status rtlsdr-ogn

# ogn-rf ステータス
curl -s http://localhost:8082/ | head -20

# ogn-decode ステータス
curl -s http://localhost:8083/ | head -20

# 受信航空機リスト
curl -s http://localhost:8083/aircraft-list.txt

# telnet コンソール
telnet localhost 50000   # ogn-rf
telnet localhost 50001   # ogn-decode
```

---

## 7. MQTT ブローカー構築

### 7.1 Mosquitto インストール

```bash
sudo apt-get install -y mosquitto mosquitto-clients
```

### 7.2 設定

```bash
sudo tee /etc/mosquitto/conf.d/ogn.conf << 'EOF'
# OGN MQTT configuration
listener 1883
allow_anonymous true
max_queued_messages 1000
EOF
```

### 7.3 起動

```bash
sudo systemctl restart mosquitto
sudo systemctl enable mosquitto
sudo systemctl status mosquitto
```

### 7.4 接続テスト

```bash
# ターミナル1: サブスクライブ
mosquitto_sub -h localhost -t 'test/#' -v

# ターミナル2: パブリッシュ
mosquitto_pub -h localhost -t 'test/hello' -m '{"msg":"hello"}'
```

---

## 8. MQTT パブリッシャー構築

### 8.1 Python MQTT ライブラリインストール

```bash
sudo apt-get install -y python3-paho-mqtt
```

### 8.2 ogn-mqtt.py 作成

以下のファイルを `/home/pi/rtlsdr-ogn/ogn-mqtt.py` として作成する。

ogn-decode の HTTP エンドポイント (`localhost:8083/aircraft-list.txt` および `localhost:8083/`) をポーリングし、パースした JSON を MQTT トピックにパブリッシュする。

```python
#!/usr/bin/env python3
"""OGN FLARM MQTT Publisher

Polls ogn-decode HTTP endpoints and publishes decoded FLARM data to MQTT.
Designed for the Japan 922.4 MHz OGN receiver.
"""

import json
import re
import time
import signal
import sys
import logging
from datetime import datetime, timezone
from urllib.request import urlopen
from urllib.error import URLError
from html.parser import HTMLParser

import paho.mqtt.client as mqtt

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
OGN_DECODE_HOST = "localhost"
OGN_DECODE_PORT = 8083
OGN_RF_PORT = 8082
MQTT_BROKER = "localhost"
MQTT_PORT = 1883
MQTT_BASE_TOPIC = "ogn"
RECEIVER_ID = "TestJP"
POLL_INTERVAL = 2  # seconds
POSITION_RETAIN = False
STATUS_RETAIN = True

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%S",
)
log = logging.getLogger("ogn-mqtt")

# ---------------------------------------------------------------------------
# HTML status page parser
# ---------------------------------------------------------------------------
class StatusPageParser(HTMLParser):
    """Extract key-value pairs from ogn-decode status HTML table."""

    def __init__(self):
        super().__init__()
        self._in_td = False
        self._in_th = False
        self._in_b = False
        self._cells = []
        self._current = ""
        self._section = ""
        self.data = {}
        self.aprs_beacon = ""
        self.aprs_status = ""
        self._capture_next_samp = None

    def handle_starttag(self, tag, attrs):
        if tag == "td":
            self._in_td = True
            self._current = ""
        elif tag == "th":
            self._in_th = True
            self._current = ""
        elif tag == "b":
            self._in_b = True
        elif tag == "samp":
            if self._capture_next_samp is not None:
                self._capture_next_samp = ""

    def handle_endtag(self, tag):
        if tag == "td":
            self._in_td = False
            self._cells.append(self._current.strip())
        elif tag == "th":
            self._in_th = False
            val = self._current.strip()
            if val:
                self._section = val
            self._cells = []
        elif tag == "tr":
            if len(self._cells) >= 2:
                key = self._cells[0].strip().replace("\xa0", "")
                val = self._cells[1].strip()
                self.data[key] = val
            self._cells = []
        elif tag == "b":
            self._in_b = False
        elif tag == "samp":
            if self._capture_next_samp is not None:
                if self.aprs_beacon == "":
                    self.aprs_beacon = self._capture_next_samp.strip()
                else:
                    self.aprs_status = self._capture_next_samp.strip()
                self._capture_next_samp = None

    def handle_data(self, data):
        if self._in_td or self._in_th:
            self._current += data
        if self._capture_next_samp is not None:
            self._capture_next_samp += data
        if "APRS beacon:" in data:
            self._capture_next_samp = ""
        elif "APRS status:" in data:
            self._capture_next_samp = ""


# ---------------------------------------------------------------------------
# Parsers for ogn-decode output
# ---------------------------------------------------------------------------

def parse_aircraft_header(line):
    """Parse aircraft summary header line.

    Example:
    FLRDB0253 [   20/  141sec] 1:2:DB0253 F*  < 0.1m/s> <47.3dB>, <0.0bit/packet>, < +0.50(0.00)kHz>
    """
    m = re.match(
        r"(\w+)\s+\[\s*(\d+)/\s*(\d+)sec\]\s+"
        r"(\d+):(\d+):(\w+)\s+(\S+)\s+"
        r"<\s*([\d.]+)m/s>\s+<([\d.]+)dB>,\s+"
        r"<([\d.]+)bit/packet>,\s+"
        r"<\s*([+\-\d.]+)\(([+\-\d.]+)\)kHz>",
        line,
    )
    if not m:
        return None
    return {
        "device_id": m.group(1),
        "packets_received": int(m.group(2)),
        "last_seen_sec": int(m.group(3)),
        "protocol": int(m.group(4)),
        "address_type": int(m.group(5)),
        "address": m.group(6),
        "flags": m.group(7),
        "avg_speed_ms": float(m.group(8)),
        "avg_snr_db": float(m.group(9)),
        "avg_bit_errors": float(m.group(10)),
        "freq_offset_khz": float(m.group(11)),
        "freq_correction_khz": float(m.group(12)),
    }


def parse_position_line(line):
    """Parse a position report line.

    Example:
    133401: [ +35.71623,+139.75189]deg    44m  +0.0m/s   0.1m/s 180.0deg  +0.0deg/s __1 03x03m Fn:13___ +0.50kHz 44.5/58.0dB/0  0e     0.0km 090.0deg +28.3deg
    """
    m = re.match(
        r"\s*(\d+):\s+\[\s*([+\-\d.]+),\s*([+\-\d.]+)\]deg\s+"
        r"(\d+)m\s+"
        r"([+\-\d.]+)m/s\s+"
        r"([\d.]+)m/s\s+"
        r"([\d.]+)deg\s+"
        r"([+\-\d.]+)deg/s\s+"
        r"(\S{3})\s+"
        r"(\d+)x(\d+)m\s+"
        r"Fn:(\S+)\s+"
        r"([+\-\d.]+)kHz\s+"
        r"([\d.]+)/([\d.]+)dB/(\d+)\s+"
        r"(\d+)e\s+"
        r"([\d.]+)km\s+"
        r"([\d.]+)deg\s+"
        r"([+\-\d.]+)deg",
        line,
    )
    if not m:
        return None

    timestamp_sod = int(m.group(1))
    now_utc = datetime.now(timezone.utc)
    # ogn-decode uses seconds-of-day but can exceed 86400 (cumulative uptime counter)
    sod = timestamp_sod % 86400
    h = sod // 3600
    mi = (sod % 3600) // 60
    s = sod % 60
    ts = now_utc.replace(hour=h, minute=mi, second=s, microsecond=0)
    if ts > now_utc:
        from datetime import timedelta
        ts -= timedelta(days=1)

    flags_raw = m.group(9)
    return {
        "timestamp_utc": ts.isoformat(),
        "timestamp_sod": timestamp_sod,
        "latitude": float(m.group(2)),
        "longitude": float(m.group(3)),
        "altitude_m": int(m.group(4)),
        "climb_rate_ms": float(m.group(5)),
        "ground_speed_ms": float(m.group(6)),
        "heading_deg": float(m.group(7)),
        "turn_rate_degs": float(m.group(8)),
        "stealth": flags_raw[0] != "_",
        "relay": flags_raw[1] != "_",
        "no_tracking": flags_raw[2] == "1",
        "flags_raw": flags_raw,
        "h_accuracy_m": int(m.group(10)),
        "v_accuracy_m": int(m.group(11)),
        "frame_info": m.group(12),
        "freq_offset_khz": float(m.group(13)),
        "snr_db": float(m.group(14)),
        "signal_db": float(m.group(15)),
        "channel_errors": int(m.group(16)),
        "bit_errors": int(m.group(17)),
        "distance_km": float(m.group(18)),
        "bearing_deg": float(m.group(19)),
        "elevation_deg": float(m.group(20)),
        "is_latest": line.rstrip().endswith("*"),
    }


def parse_aircraft_list(text):
    """Parse full aircraft-list.txt into structured data."""
    aircraft = {}
    current_id = None

    for line in text.splitlines():
        line = line.rstrip()
        if not line:
            continue

        header = parse_aircraft_header(line)
        if header:
            current_id = header["device_id"]
            aircraft[current_id] = {
                "summary": header,
                "positions": [],
                "latest_position": None,
            }
            continue

        if current_id:
            pos = parse_position_line(line)
            if pos:
                aircraft[current_id]["positions"].append(pos)
                if pos["is_latest"]:
                    aircraft[current_id]["latest_position"] = pos

    # If no position was marked latest, use the last one
    for ac in aircraft.values():
        if ac["latest_position"] is None and ac["positions"]:
            ac["latest_position"] = ac["positions"][-1]

    return aircraft


def parse_receiver_status(html):
    """Parse ogn-decode HTML status page into structured data."""
    parser = StatusPageParser()
    parser.feed(html)
    d = parser.data

    def extract_float(s, default=None):
        m = re.search(r"[+\-]?\d+\.?\d*", s or "")
        return float(m.group()) if m else default

    def extract_int(s, default=None):
        m = re.search(r"\d+", s or "")
        return int(m.group()) if m else default

    # CPU load
    cpu_load = d.get("CPU load", "")
    cpu_parts = [float(x) for x in cpu_load.split("/") if x.strip()] if cpu_load else []

    # RAM
    ram_str = d.get("RAM [free/total]", "")
    ram_m = re.match(r"([\d.]+)/([\d.]+)\s*MB", ram_str)

    # Traffic
    def parse_traffic(s):
        m = re.match(r"\s*(\d+)/\s*(\d+)", s or "")
        if m:
            return {"visible": int(m.group(1)), "total": int(m.group(2))}
        return None

    # APRS connection
    aprs_server = d.get("APRS.Server[0]", "")
    connected_to = d.get("connected to", "")
    connected_for = d.get("connected for", "")
    kb_str = d.get("KiloBytes sent/received", "")
    kb_m = re.match(r"(\d+)/(\d+)", kb_str)

    return {
        "receiver_id": RECEIVER_ID,
        "timestamp_utc": datetime.now(timezone.utc).isoformat(),
        "software": d.get("Software", ""),
        "hostname": d.get("Host name", ""),
        "position": {
            "latitude": extract_float(d.get("Position.Latitude")),
            "longitude": extract_float(d.get("Position.Longitude")),
            "altitude_m": extract_int(d.get("Position.Altitude")),
            "geoid_separation_m": extract_int(d.get("EGM96->GeoidSepar")),
        },
        "system": {
            "cpu_load": cpu_parts,
            "ram_free_mb": float(ram_m.group(1)) if ram_m else None,
            "ram_total_mb": float(ram_m.group(2)) if ram_m else None,
            "cpu_temp_c": extract_float(d.get("CPU temperature")),
        },
        "ntp": {
            "utc_time": d.get("NTP UTC time", ""),
            "error_ms": extract_float(d.get("NTP est. error")),
            "freq_correction_ppm": extract_float(d.get("NTP freq. corr.")),
        },
        "rf": {
            "freq_plan": d.get("RF.FreqPlan", ""),
            "input_noise_db": extract_float(d.get("RF input noise")),
        },
        "demodulator": {
            "detect_snr_db": extract_float(d.get("Demodulator.DetectSNR")),
            "scan_margin_khz": extract_float(d.get("Demodulator.ScanMargin")),
        },
        "traffic": {
            "last_12h": parse_traffic(d.get("Aircrafts received over last 12 hours")),
            "last_1h": parse_traffic(d.get("Aircrafts received over last hour")),
            "last_1m": parse_traffic(d.get("Aircrafts received over last minute")),
            "positions_last_1m": parse_traffic(d.get("Positions received over last minute")),
        },
        "aprs": {
            "server": aprs_server,
            "connected_to": connected_to,
            "connected_for": connected_for,
            "kb_sent": int(kb_m.group(1)) if kb_m else None,
            "kb_received": int(kb_m.group(2)) if kb_m else None,
            "call": d.get("APRS.Call", ""),
            "beacon_interval_sec": extract_int(d.get("APRS.Beacon.Interval")),
            "position_interval_sec": extract_int(d.get("APRS.PositionInterval")),
        },
    }


# ---------------------------------------------------------------------------
# HTTP fetch helpers
# ---------------------------------------------------------------------------

def fetch_url(url, timeout=5):
    """Fetch URL content, return string or None on error."""
    try:
        with urlopen(url, timeout=timeout) as resp:
            return resp.read().decode("utf-8", errors="replace")
    except (URLError, OSError, TimeoutError) as e:
        log.warning("Failed to fetch %s: %s", url, e)
        return None


# ---------------------------------------------------------------------------
# MQTT publishing
# ---------------------------------------------------------------------------

class OgnMqttPublisher:
    def __init__(self):
        self.client = mqtt.Client(
            client_id=f"ogn-mqtt-{RECEIVER_ID}",
            callback_api_version=mqtt.CallbackAPIVersion.VERSION2,
        )
        self.client.on_connect = self._on_connect
        self.client.on_disconnect = self._on_disconnect
        self.client.will_set(
            f"{MQTT_BASE_TOPIC}/{RECEIVER_ID}/status",
            payload=json.dumps({"online": False}),
            qos=1,
            retain=True,
        )
        self._connected = False
        self._prev_positions = {}  # device_id -> last timestamp_sod published

    def _on_connect(self, client, userdata, flags, rc, properties=None):
        if rc == 0:
            log.info("Connected to MQTT broker")
            self._connected = True
        else:
            log.error("MQTT connection failed: rc=%s", rc)

    def _on_disconnect(self, client, userdata, flags, rc, properties=None):
        log.warning("Disconnected from MQTT broker: rc=%s", rc)
        self._connected = False

    def connect(self):
        self.client.connect(MQTT_BROKER, MQTT_PORT, keepalive=60)
        self.client.loop_start()

    def stop(self):
        self.client.loop_stop()
        self.client.disconnect()

    def _publish(self, topic, payload, retain=False, qos=0):
        msg = json.dumps(payload, ensure_ascii=False)
        self.client.publish(topic, msg, qos=qos, retain=retain)

    def publish_aircraft_position(self, device_id, position):
        """Publish a single position report."""
        topic = f"{MQTT_BASE_TOPIC}/{RECEIVER_ID}/aircraft/{device_id}/position"
        self._publish(topic, position, retain=POSITION_RETAIN, qos=0)

    def publish_aircraft_status(self, device_id, summary, latest_position):
        """Publish aircraft summary with latest position."""
        topic = f"{MQTT_BASE_TOPIC}/{RECEIVER_ID}/aircraft/{device_id}/status"
        payload = {**summary}
        if latest_position:
            payload["latest_position"] = latest_position
        self._publish(topic, payload, retain=True, qos=1)

    def publish_aircraft_list(self, aircraft_dict):
        """Publish aggregated list of all tracked aircraft."""
        topic = f"{MQTT_BASE_TOPIC}/{RECEIVER_ID}/aircraft"
        summary_list = []
        for dev_id, ac in aircraft_dict.items():
            entry = {**ac["summary"]}
            if ac["latest_position"]:
                entry["latest_position"] = ac["latest_position"]
            summary_list.append(entry)
        self._publish(
            topic,
            {
                "timestamp_utc": datetime.now(timezone.utc).isoformat(),
                "count": len(summary_list),
                "aircraft": summary_list,
            },
            retain=True,
            qos=1,
        )

    def publish_receiver_status(self, status):
        """Publish receiver status."""
        topic = f"{MQTT_BASE_TOPIC}/{RECEIVER_ID}/status"
        status["online"] = True
        self._publish(topic, status, retain=STATUS_RETAIN, qos=1)

    def poll_and_publish(self):
        """Single poll cycle: fetch data and publish to MQTT."""
        base = f"http://{OGN_DECODE_HOST}:{OGN_DECODE_PORT}"

        # Fetch aircraft list
        aircraft_text = fetch_url(f"{base}/aircraft-list.txt")
        if aircraft_text:
            aircraft = parse_aircraft_list(aircraft_text)

            for dev_id, ac in aircraft.items():
                # Publish only new positions (avoid duplicates)
                prev_ts = self._prev_positions.get(dev_id)
                new_positions = []
                for pos in ac["positions"]:
                    if prev_ts is None or pos["timestamp_sod"] > prev_ts:
                        new_positions.append(pos)

                for pos in new_positions:
                    self.publish_aircraft_position(dev_id, pos)

                if ac["positions"]:
                    self._prev_positions[dev_id] = ac["positions"][-1]["timestamp_sod"]

                # Always publish status with latest position
                self.publish_aircraft_status(
                    dev_id, ac["summary"], ac["latest_position"]
                )

            # Publish aggregated list
            self.publish_aircraft_list(aircraft)

            if aircraft:
                ids = ", ".join(aircraft.keys())
                log.debug("Published %d aircraft: %s", len(aircraft), ids)

        # Fetch receiver status (less frequent - every 5th cycle)
        if not hasattr(self, "_status_counter"):
            self._status_counter = 0
        self._status_counter += 1

        if self._status_counter >= 5:
            self._status_counter = 0
            status_html = fetch_url(f"{base}/")
            if status_html:
                status = parse_receiver_status(status_html)
                self.publish_receiver_status(status)
                log.debug("Published receiver status")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    publisher = OgnMqttPublisher()

    def shutdown(signum, frame):
        log.info("Shutting down...")
        publisher._publish(
            f"{MQTT_BASE_TOPIC}/{RECEIVER_ID}/status",
            {"online": False},
            retain=True,
            qos=1,
        )
        publisher.stop()
        sys.exit(0)

    signal.signal(signal.SIGTERM, shutdown)
    signal.signal(signal.SIGINT, shutdown)

    log.info("OGN MQTT Publisher starting")
    log.info("Receiver: %s, Broker: %s:%d", RECEIVER_ID, MQTT_BROKER, MQTT_PORT)
    log.info("Base topic: %s/%s/", MQTT_BASE_TOPIC, RECEIVER_ID)
    log.info("Poll interval: %ds", POLL_INTERVAL)

    publisher.connect()

    # Wait for connection
    for _ in range(10):
        if publisher._connected:
            break
        time.sleep(0.5)

    if not publisher._connected:
        log.error("Could not connect to MQTT broker")
        sys.exit(1)

    log.info("Running. Press Ctrl+C to stop.")

    while True:
        try:
            publisher.poll_and_publish()
        except Exception:
            log.exception("Error in poll cycle")
        time.sleep(POLL_INTERVAL)


if __name__ == "__main__":
    main()
```

### 8.3 実行権限付与

```bash
chmod +x /home/pi/rtlsdr-ogn/ogn-mqtt.py
```

### 8.4 設定パラメータ

スクリプト先頭の定数を環境に合わせて変更する:

| パラメータ | デフォルト | 説明 |
|-----------|----------|------|
| `OGN_DECODE_HOST` | `localhost` | ogn-decode ホスト |
| `OGN_DECODE_PORT` | `8083` | ogn-decode HTTP ポート |
| `MQTT_BROKER` | `localhost` | MQTT ブローカーホスト |
| `MQTT_PORT` | `1883` | MQTT ブローカーポート |
| `MQTT_BASE_TOPIC` | `ogn` | ベーストピック |
| `RECEIVER_ID` | `TestJP` | レシーバー識別子 (APRS Call と一致させる) |
| `POLL_INTERVAL` | `2` | ポーリング間隔 (秒) |
| `POSITION_RETAIN` | `False` | 位置メッセージの retain |
| `STATUS_RETAIN` | `True` | ステータスメッセージの retain |

---

## 9. MQTT パブリッシャーサービス化

### 9.1 systemd サービスファイル

```bash
sudo tee /etc/systemd/system/ogn-mqtt.service << 'EOF'
[Unit]
Description=OGN FLARM MQTT Publisher
After=network-online.target mosquitto.service rtlsdr-ogn.service
Wants=network-online.target
Requires=mosquitto.service

[Service]
Type=simple
User=pi
WorkingDirectory=/home/pi/rtlsdr-ogn
ExecStart=/usr/bin/python3 /home/pi/rtlsdr-ogn/ogn-mqtt.py
Restart=on-failure
RestartSec=10
StandardOutput=journal
StandardError=journal
SyslogIdentifier=ogn-mqtt

[Install]
WantedBy=multi-user.target
EOF
```

### 9.2 有効化と起動

```bash
sudo systemctl daemon-reload
sudo systemctl enable ogn-mqtt
sudo systemctl start ogn-mqtt
```

---

## 10. 動作確認

### 10.1 全サービスの状態確認

```bash
sudo systemctl status rtlsdr-ogn --no-pager
sudo systemctl status mosquitto --no-pager
sudo systemctl status ogn-mqtt --no-pager
```

### 10.2 MQTT メッセージの確認

```bash
# 全トピックをリアルタイム表示
mosquitto_sub -h localhost -t 'ogn/#' -v

# 位置データのみ
mosquitto_sub -h localhost -t 'ogn/TestJP/aircraft/+/position' -v

# レシーバーステータスのみ
mosquitto_sub -h localhost -t 'ogn/TestJP/status' -v

# JSON を整形表示
mosquitto_sub -h localhost -t 'ogn/#' | python3 -m json.tool
```

### 10.3 期待される MQTT トピック

| トピック | QoS | Retain | 内容 |
|---------|-----|--------|------|
| `ogn/TestJP/aircraft/{id}/position` | 0 | No | 位置レポート (パケットごと) |
| `ogn/TestJP/aircraft/{id}/status` | 1 | Yes | 航空機サマリー + 最新位置 |
| `ogn/TestJP/aircraft` | 1 | Yes | 全航空機の集約リスト |
| `ogn/TestJP/status` | 1 | Yes | レシーバーシステム情報 |

### 10.4 ログ確認

```bash
# ogn-mqtt のログ
journalctl -u ogn-mqtt -f

# Mosquitto のログ
sudo tail -f /var/log/mosquitto/mosquitto.log
```

---

## 11. トラブルシューティング

### RTL-SDR が認識されない

```bash
# デバイス確認
lsusb | grep RTL
rtl_test -t

# DVB-T モジュールが残っている場合
lsmod | grep dvb
# → blacklist 設定後に再起動が必要
```

### ogn-rf がすぐ終了する

```bash
# procServ 経由で起動しているか確認
ps aux | grep procServ
# → rtlsdr-ogn スクリプト経由で起動すること (stdin の EOF 対策)
```

### フレーム検出されるがデコード数 0

```bash
# ogn-decode のコンソールで確認
telnet localhost 50001
# "frames detected" > 0 だが "demodulated" = 0 の場合:
# → バイナリパッチが正しく適用されていない可能性
# → ogn-rf と ogn-decode の両方がパッチ済みか確認
```

### ogn-decode が -inf ノイズ表示

```bash
# ogn-rf のみパッチして ogn-decode 未パッチの場合に発生
# → 両方のバイナリに同一パッチを適用すること
```

### MQTT に接続できない

```bash
# Mosquitto が起動しているか
sudo systemctl status mosquitto

# ポート確認
ss -tlnp | grep 1883

# テスト
mosquitto_pub -h localhost -t test -m "hello"
```

### ogn-mqtt がエラーを出す

```bash
# ログ確認
journalctl -u ogn-mqtt -f

# ogn-decode の HTTP が応答するか
curl -s http://localhost:8083/aircraft-list.txt

# 手動テスト実行
cd /home/pi/rtlsdr-ogn && python3 ogn-mqtt.py
```

---

## 12. ファイル一覧

### 作成・変更ファイル

| パス | 内容 |
|------|------|
| `/home/pi/rtlsdr-ogn/FLARM.conf` | OGN レシーバー設定 |
| `/home/pi/rtlsdr-ogn/rtlsdr-ogn.conf` | procServ 設定 |
| `/home/pi/rtlsdr-ogn/ogn-rf` | パッチ済み RF プロセッサ |
| `/home/pi/rtlsdr-ogn/ogn-decode` | パッチ済みデコーダ |
| `/home/pi/rtlsdr-ogn/ogn-rf.v033orig` | ogn-rf オリジナルバックアップ |
| `/home/pi/rtlsdr-ogn/ogn-decode.orig` | ogn-decode オリジナルバックアップ |
| `/home/pi/rtlsdr-ogn/ogn-mqtt.py` | MQTT パブリッシャー |
| `/etc/systemd/system/rtlsdr-ogn.service` | OGN レシーバー systemd |
| `/etc/systemd/system/ogn-mqtt.service` | MQTT パブリッシャー systemd |
| `/etc/mosquitto/conf.d/ogn.conf` | Mosquitto 設定 |
| `/etc/modprobe.d/blacklist-rtlsdr.conf` | DVB-T ブラックリスト |
| `/boot/firmware/config.txt` | USB 電力設定 (追記行) |

### サービス起動順序

```
rtlsdr-ogn.service (ogn-rf + ogn-decode)
    ↓
mosquitto.service (MQTT ブローカー)
    ↓
ogn-mqtt.service (パブリッシャー)
```

### データフロー

```
FLARM 922.4 MHz → RTL-SDR → ogn-rf (FFT)
    → FIFO → ogn-decode (デコード)
    → HTTP :8083 → ogn-mqtt.py (パース)
    → MQTT :1883 → サブスクライバー
    → APRS → aprs.glidernet.org (OGN ネットワーク)

ADS-B 1090 MHz → tar1090/dump1090 (別機器)
    → HTTP aircraft.json → adsb-poller.py (ポーリング)
    → MQTT :1883 → サブスクライバー
```

### ポート一覧

| ポート | サービス | 用途 |
|-------|---------|------|
| 1883 | Mosquitto | MQTT ブローカー |
| 8082 | ogn-rf | RF ステータス HTTP |
| 8083 | ogn-decode | デコードステータス HTTP |
| 50000 | procServ | ogn-rf telnet コンソール |
| 50001 | procServ | ogn-decode telnet コンソール |

---

## 13. ADS-B 受信設定

### 13.1 概要

同一ネットワーク上の FlightRadar24 フィーダー等（tar1090 / dump1090）から ADS-B / Mode-S / Mode-C データを取得し、MQTT 経由で Web アプリに配信する。FLARM 受信と並行して動作可能。

### 13.2 adsb-poller.py 配置

ファイルは `/home/pi/rtlsdr-ogn/adsb-poller.py` に配置済み。

### 13.3 systemd サービスファイル

```bash
sudo tee /etc/systemd/system/adsb-poller.service << 'EOF'
[Unit]
Description=ADS-B Poller for OGN WebApp
After=network-online.target mosquitto.service
Wants=network-online.target
Requires=mosquitto.service

[Service]
Type=simple
User=pi
WorkingDirectory=/home/pi/rtlsdr-ogn
ExecStart=/usr/bin/python3 /home/pi/rtlsdr-ogn/adsb-poller.py --url http://192.168.190.148/tar1090/data/aircraft.json --interval 3
Restart=on-failure
RestartSec=10
SyslogIdentifier=adsb-poller

[Install]
WantedBy=multi-user.target
EOF
```

### 13.4 有効化

```bash
sudo systemctl daemon-reload
sudo systemctl enable adsb-poller
sudo systemctl start adsb-poller
```

### 13.5 Web アプリからの制御

設定画面の「ADS-B 受信設定」から URL・ポーリング間隔を設定し、有効/無効を切り替えられる。Web アプリは systemd override を動的に書き換えてサービスを再起動する。

### 13.6 MQTT トピック

| トピック | 内容 |
|---------|------|
| `ogn/{receiver_id}/aircraft/{ADSB_HEXID}/position` | ADS-B 機体の位置 |
| `ogn/{receiver_id}/aircraft_adsb` | ADS-B 全機体の集約リスト |

### 13.7 ADS-B 機体分類

| tar1090 type | 分類 | マップ色 |
|-------------|------|---------|
| `adsb_icao`, `adsb_icao_nt`, `tisb_*` | ADS-B | 青 |
| `mode_s`, `mlat`, `adsc`, その他 | Mode-S/C | 黒 |

---

*本書は 2026-03-20 時点の実稼働環境から更新。OGN ソフトウェア v0.3.3 ARM64 対象。*
