# OGN FLARM MQTT API 仕様書

**バージョン**: 2.0
**更新日**: 2026-03-20
**対象システム**: OGN FLARM レシーバー (日本 922.4 MHz)

---

## 1. 概要

本 API は、OGN (Open Glider Network) レシーバーがデコードした FLARM 航空機データを MQTT プロトコル経由でリアルタイム配信する。ogn-decode の HTTP エンドポイントからデータを取得し、構造化 JSON として MQTT トピックにパブリッシュする。

### 1.1 システム構成

```
PowerFLARM (922.4 MHz)
    ↓ RF
RTL-SDR Blog V4
    ↓ USB
ogn-rf (FFT/検出)
    ↓ FIFO
ogn-decode (デコード)
    ↓ HTTP (localhost:8083)
ogn-mqtt.py (パーサー + パブリッシャー)
    ↓ MQTT
Mosquitto Broker (localhost:1883)
    ↓ MQTT
サブスクライバー (アプリ/ダッシュボード/ログ)
```

### 1.2 接続情報

| 項目 | 値 |
|------|-----|
| プロトコル | MQTT v3.1.1 / v5.0 |
| ブローカー | `localhost:1883` |
| 認証 | なし (anonymous) |
| TLS | なし (ローカルネットワーク向け) |
| ベーストピック | `ogn/{receiver_id}/` |
| デフォルト receiver_id | `TestJP` |
| ポーリング間隔 | 2 秒 |
| レシーバーステータス間隔 | 10 秒 |

---

## 2. トピック一覧

| # | トピック | QoS | Retain | 説明 |
|---|---------|-----|--------|------|
| 1 | `ogn/{receiver_id}/aircraft/{device_id}/position` | 0 | No | 個別航空機の位置レポート (1パケットごと) |
| 2 | `ogn/{receiver_id}/aircraft/{device_id}/status` | 1 | Yes | 個別航空機のサマリー + 最新位置 |
| 3 | `ogn/{receiver_id}/aircraft` | 1 | Yes | 全 FLARM 航空機の集約リスト |
| 4 | `ogn/{receiver_id}/status` | 1 | Yes | レシーバーのシステムステータス |
| 5 | `ogn/{receiver_id}/aircraft_adsb` | 1 | Yes | 全 ADS-B 航空機の集約リスト (adsb-poller) |

### 2.1 ワイルドカードサブスクリプション

| パターン | 用途 |
|---------|------|
| `ogn/#` | 全データ |
| `ogn/{receiver_id}/aircraft/+/position` | 全航空機の位置ストリーム |
| `ogn/{receiver_id}/aircraft/+/status` | 全航空機のステータス |
| `ogn/{receiver_id}/aircraft/{device_id}/#` | 特定航空機の全データ |

---

## 3. メッセージフォーマット

全メッセージは **UTF-8 エンコード JSON** で配信される。

---

### 3.1 航空機位置レポート

**トピック**: `ogn/{receiver_id}/aircraft/{device_id}/position`
**QoS**: 0 | **Retain**: No
**配信タイミング**: 新規位置パケット受信ごと (約1〜10秒間隔)

#### フィールド定義

| フィールド | 型 | 単位 | 説明 | 静止時の例 | 飛行時の例 |
|-----------|------|------|------|-----------|-----------|
| `timestamp_utc` | string | ISO 8601 | UTC タイムスタンプ | `"2026-03-13T13:18:20+00:00"` | `"2026-03-13T06:30:15+00:00"` |
| `timestamp_sod` | integer | 秒 | ogn-decode 内部タイムスタンプ (秒) | `134300` | `23415` |
| `latitude` | float | 度 | 緯度 (WGS84) | `35.71629` | `36.23456` |
| `longitude` | float | 度 | 経度 (WGS84) | `139.75168` | `139.98765` |
| `altitude_m` | integer | m | 高度 (AMSL) | `36` | `1250` |
| `climb_rate_ms` | float | m/s | 上昇率 (正=上昇, 負=下降) | `0.0` | `+2.5` |
| `ground_speed_ms` | float | m/s | 対地速度 | `0.1` | `45.0` |
| `heading_deg` | float | 度 | 進行方向 (真北=0, 時計回り) | `206.5` | `135.0` |
| `turn_rate_degs` | float | 度/s | 旋回率 (正=右旋回) | `0.0` | `+3.5` |
| `stealth` | boolean | - | ステルスモード有効 | `false` | `false` |
| `relay` | boolean | - | リレー中継パケット | `false` | `false` |
| `no_tracking` | boolean | - | 追跡拒否フラグ | `true` | `false` |
| `flags_raw` | string | - | 生フラグ文字列 (3文字) | `"__1"` | `"__0"` |
| `h_accuracy_m` | integer | m | 水平位置精度 | `4` | `3` |
| `v_accuracy_m` | integer | m | 垂直位置精度 | `4` | `5` |
| `frame_info` | string | - | FLARM フレーム情報 | `"13f__"` | `"13fo_"` |
| `freq_offset_khz` | float | kHz | 周波数オフセット | `0.5` | `+0.3` |
| `snr_db` | float | dB | 信号対雑音比 | `45.2` | `22.0` |
| `signal_db` | float | dB | 信号強度 | `58.5` | `35.5` |
| `channel_errors` | integer | - | チャネルエラー数 | `0` | `0` |
| `bit_errors` | integer | - | ビットエラー数 | `0` | `2` |
| `distance_km` | float | km | レシーバーからの距離 | `0.0` | `45.3` |
| `bearing_deg` | float | 度 | レシーバーからの方位角 | `0.0` | `225.0` |
| `elevation_deg` | float | 度 | レシーバーからの仰角 | `40.8` | `1.5` |
| `is_latest` | boolean | - | 最新パケットか | `true` | `true` |

#### サンプル (静止中)

```json
{
  "timestamp_utc": "2026-03-13T13:18:20+00:00",
  "timestamp_sod": 134300,
  "latitude": 35.71629,
  "longitude": 139.75168,
  "altitude_m": 36,
  "climb_rate_ms": -0.1,
  "ground_speed_ms": 0.1,
  "heading_deg": 206.5,
  "turn_rate_degs": 0.0,
  "stealth": false,
  "relay": false,
  "no_tracking": true,
  "flags_raw": "__1",
  "h_accuracy_m": 4,
  "v_accuracy_m": 4,
  "frame_info": "13f__",
  "freq_offset_khz": 0.5,
  "snr_db": 45.2,
  "signal_db": 58.5,
  "channel_errors": 0,
  "bit_errors": 0,
  "distance_km": 0.0,
  "bearing_deg": 0.0,
  "elevation_deg": 40.8,
  "is_latest": true
}
```

#### サンプル (飛行中の期待値)

```json
{
  "timestamp_utc": "2026-03-13T06:30:15+00:00",
  "timestamp_sod": 23415,
  "latitude": 36.23456,
  "longitude": 139.98765,
  "altitude_m": 1250,
  "climb_rate_ms": 2.5,
  "ground_speed_ms": 45.0,
  "heading_deg": 135.0,
  "turn_rate_degs": 3.5,
  "stealth": false,
  "relay": false,
  "no_tracking": false,
  "flags_raw": "__0",
  "h_accuracy_m": 3,
  "v_accuracy_m": 5,
  "frame_info": "13fo_",
  "freq_offset_khz": 0.3,
  "snr_db": 22.0,
  "signal_db": 35.5,
  "channel_errors": 0,
  "bit_errors": 2,
  "distance_km": 45.3,
  "bearing_deg": 225.0,
  "elevation_deg": 1.5,
  "is_latest": true
}
```

#### 静止時 vs 飛行時のデータ差異

| フィールド | 静止時 | 飛行時 | 備考 |
|-----------|--------|--------|------|
| `ground_speed_ms` | ≈ 0.0〜0.2 (GPS ノイズ) | 20〜80+ | 対地速度は飛行の主要指標 |
| `climb_rate_ms` | ≈ 0.0 | -5.0〜+5.0 | サーマルソアリング時に顕著な変化 |
| `heading_deg` | ランダムに変動 | 飛行方向と一致 | 静止時は GPS ノイズで不安定 |
| `turn_rate_degs` | 0.0 | -6.0〜+6.0 | 旋回中に有意な値 |
| `altitude_m` | ±10m の変動 | 数百〜数千 m | 気圧高度計ベース |
| `distance_km` | 0.0 (至近) | 0〜100+ | 受信範囲に依存 |
| `bearing_deg` | 不安定 | 安定した方位 | 距離 0 では無意味 |
| `elevation_deg` | 高角度 (至近距離) | 1〜10° (遠距離) | 距離に反比例 |
| `snr_db` | 40〜55 (至近で強い) | 10〜30 (遠距離) | 距離の二乗に反比例 |
| `h_accuracy_m` | 3〜5 | 3〜15 | GPS 精度 |
| `bit_errors` | 0 (強信号) | 0〜6 | 弱信号時に増加 |

---

### 3.2 航空機ステータス

**トピック**: `ogn/{receiver_id}/aircraft/{device_id}/status`
**QoS**: 1 | **Retain**: Yes
**配信タイミング**: ポーリングサイクルごと (2秒)

#### フィールド定義

| フィールド | 型 | 単位 | 説明 |
|-----------|------|------|------|
| `device_id` | string | - | デバイス識別子 (例: `"FLRDB0253"`) |
| `packets_received` | integer | - | 受信パケット総数 |
| `last_seen_sec` | integer | 秒 | 最後のパケットからの経過時間 |
| `protocol` | integer | - | プロトコル種別 (1=FLARM, 2=OGN, 3=FANET) |
| `address_type` | integer | - | アドレスタイプ (1=ICAO, 2=FLARM, 3=OGN) |
| `address` | string | - | デバイスアドレス (16進数) |
| `flags` | string | - | デバイスフラグ (例: `"F*"`) |
| `avg_speed_ms` | float | m/s | 平均速度 |
| `avg_snr_db` | float | dB | 平均 SNR |
| `avg_bit_errors` | float | bit/packet | 平均ビットエラー率 |
| `freq_offset_khz` | float | kHz | 周波数オフセット |
| `freq_correction_khz` | float | kHz | 周波数補正値 |
| `latest_position` | object | - | 最新の位置レポート (3.1 と同一スキーマ) |

#### protocol 値

| 値 | プロトコル | 説明 |
|---|-----------|------|
| 1 | FLARM | FLARM 衝突回避システム |
| 2 | OGN Tracker | OGN 独自トラッカー |
| 3 | FANET | パラグライダー等向けネットワーク |

#### address_type 値

| 値 | タイプ | 説明 |
|---|--------|------|
| 1 | ICAO | ICAO 24bit アドレス |
| 2 | FLARM | FLARM デバイス ID |
| 3 | OGN | OGN トラッカー ID |

#### サンプル

```json
{
  "device_id": "FLRDB0253",
  "packets_received": 20,
  "last_seen_sec": 170,
  "protocol": 1,
  "address_type": 2,
  "address": "DB0253",
  "flags": "F*",
  "avg_speed_ms": 0.1,
  "avg_snr_db": 50.2,
  "avg_bit_errors": 0.0,
  "freq_offset_khz": 0.5,
  "freq_correction_khz": 0.0,
  "latest_position": {
    "timestamp_utc": "2026-03-13T13:22:15+00:00",
    "latitude": 35.71618,
    "longitude": 139.7519,
    "altitude_m": 77,
    "climb_rate_ms": -0.1,
    "ground_speed_ms": 0.0,
    "heading_deg": 341.5,
    "turn_rate_degs": 0.0,
    "snr_db": 51.0,
    "distance_km": 0.0,
    "bearing_deg": 108.3,
    "elevation_deg": 57.3
  }
}
```

---

### 3.3 航空機リスト (集約)

**トピック**: `ogn/{receiver_id}/aircraft`
**QoS**: 1 | **Retain**: Yes
**配信タイミング**: ポーリングサイクルごと (2秒)

#### フィールド定義

| フィールド | 型 | 説明 |
|-----------|------|------|
| `timestamp_utc` | string | 集約時刻 (ISO 8601) |
| `count` | integer | 航空機数 |
| `aircraft` | array | 航空機オブジェクトの配列 (3.2 と同一スキーマ) |

#### サンプル

```json
{
  "timestamp_utc": "2026-03-13T13:45:52.631010+00:00",
  "count": 1,
  "aircraft": [
    {
      "device_id": "FLRDB0253",
      "packets_received": 20,
      "last_seen_sec": 170,
      "protocol": 1,
      "address_type": 2,
      "address": "DB0253",
      "flags": "F*",
      "avg_speed_ms": 0.1,
      "avg_snr_db": 50.2,
      "avg_bit_errors": 0.0,
      "freq_offset_khz": 0.5,
      "freq_correction_khz": 0.0,
      "latest_position": { "..." : "..." }
    }
  ]
}
```

---

### 3.4 レシーバーステータス

**トピック**: `ogn/{receiver_id}/status`
**QoS**: 1 | **Retain**: Yes
**配信タイミング**: 10 秒ごと
**特記**: 起動時 `{"online": true}`, 終了時 `{"online": false}` (Last Will)

#### フィールド定義

| フィールド | 型 | 説明 |
|-----------|------|------|
| `receiver_id` | string | レシーバー識別子 |
| `timestamp_utc` | string | ステータス取得時刻 (ISO 8601) |
| `online` | boolean | レシーバーオンライン状態 |
| `software` | string | ソフトウェアバージョン |
| `hostname` | string | ホスト名 |
| `position` | object | レシーバー設置位置 |
| `position.latitude` | float | 緯度 (度) |
| `position.longitude` | float | 経度 (度) |
| `position.altitude_m` | integer | 高度 (m AMSL) |
| `position.geoid_separation_m` | integer | ジオイド高 (m) |
| `system` | object | システムリソース |
| `system.cpu_load` | array[float] | CPU 負荷 (1/5/15分) |
| `system.ram_free_mb` | float | 空きメモリ (MB) |
| `system.ram_total_mb` | float | 総メモリ (MB) |
| `system.cpu_temp_c` | float | CPU 温度 (℃) |
| `ntp` | object | 時刻同期情報 |
| `ntp.utc_time` | string | NTP 同期時刻 |
| `ntp.error_ms` | float | 推定誤差 (ms) |
| `ntp.freq_correction_ppm` | float | 周波数補正 (ppm) |
| `rf` | object | RF 設定 |
| `rf.freq_plan` | string | 周波数プラン名 |
| `rf.input_noise_db` | float | 入力ノイズ (dB) |
| `demodulator` | object | 復調器設定 |
| `demodulator.detect_snr_db` | float | 検出 SNR 閾値 (dB) |
| `demodulator.scan_margin_khz` | float | スキャンマージン (kHz) |
| `traffic` | object | トラフィック統計 |
| `traffic.last_12h` | object | 過去12時間 `{visible, total}` |
| `traffic.last_1h` | object | 過去1時間 `{visible, total}` |
| `traffic.last_1m` | object | 過去1分間 `{visible, total}` |
| `traffic.positions_last_1m` | object | 過去1分間の位置数 `{visible, total}` |
| `aprs` | object | APRS 接続情報 |
| `aprs.server` | string | APRS サーバー |
| `aprs.connected_to` | string | 接続先 IP |
| `aprs.connected_for` | string | 接続時間 |
| `aprs.kb_sent` | integer | 送信量 (KB) |
| `aprs.kb_received` | integer | 受信量 (KB) |
| `aprs.call` | string | APRS コールサイン |
| `aprs.beacon_interval_sec` | integer | ビーコン間隔 (秒) |
| `aprs.position_interval_sec` | integer | 位置更新間隔 (秒) |

#### サンプル

```json
{
  "receiver_id": "TestJP",
  "timestamp_utc": "2026-03-13T13:37:26.000000+00:00",
  "online": true,
  "software": "RTLSDR-OGN 0.3.3.arm64",
  "hostname": "FLARM",
  "position": {
    "latitude": 35.7163,
    "longitude": 139.7516,
    "altitude_m": 30,
    "geoid_separation_m": 37
  },
  "system": {
    "cpu_load": [0.2, 0.2, 0.2],
    "ram_free_mb": 4331.7,
    "ram_total_mb": 8454.7,
    "cpu_temp_c": 57.8
  },
  "ntp": {
    "utc_time": "13:37:26",
    "error_ms": 0.7,
    "freq_correction_ppm": 1.19
  },
  "rf": {
    "freq_plan": "3: Australia/Chile",
    "input_noise_db": -2.4
  },
  "demodulator": {
    "detect_snr_db": 5.0,
    "scan_margin_khz": 30.0
  },
  "traffic": {
    "last_12h": {"visible": 1, "total": 1},
    "last_1h": {"visible": 1, "total": 1},
    "last_1m": {"visible": 1, "total": 1},
    "positions_last_1m": {"visible": 6, "total": 6}
  },
  "aprs": {
    "server": "-> aprs.glidernet.org:14580",
    "connected_to": "148.251.228.229:14580",
    "connected_for": "00h47",
    "kb_sent": 25,
    "kb_received": 11,
    "call": "TestJP",
    "beacon_interval_sec": 300,
    "position_interval_sec": 20
  }
}
```

---

## 4. Last Will and Testament (LWT)

MQTT クライアントが予期せず切断された場合、ブローカーが自動的に以下を配信:

| トピック | ペイロード | QoS | Retain |
|---------|----------|-----|--------|
| `ogn/{receiver_id}/status` | `{"online": false}` | 1 | Yes |

正常終了時も同一メッセージをパブリッシュしてからディスコネクトする。

---

## 5. 使用例

### 5.1 コマンドラインでの購読

```bash
# 全データ
mosquitto_sub -h localhost -t 'ogn/#' -v

# 特定航空機の位置のみ
mosquitto_sub -h localhost -t 'ogn/TestJP/aircraft/FLRDB0253/position'

# 全航空機の位置 (ワイルドカード)
mosquitto_sub -h localhost -t 'ogn/TestJP/aircraft/+/position'

# レシーバーステータスのみ
mosquitto_sub -h localhost -t 'ogn/TestJP/status'

# JSON を整形して表示
mosquitto_sub -h localhost -t 'ogn/#' | python3 -m json.tool
```

### 5.2 Python クライアント例

```python
import json
import paho.mqtt.client as mqtt

def on_message(client, userdata, msg):
    data = json.loads(msg.payload)
    if "/position" in msg.topic:
        print(f"{data['timestamp_utc']} "
              f"lat={data['latitude']:.5f} "
              f"lon={data['longitude']:.5f} "
              f"alt={data['altitude_m']}m "
              f"spd={data['ground_speed_ms']}m/s "
              f"hdg={data['heading_deg']}°")

client = mqtt.Client(callback_api_version=mqtt.CallbackAPIVersion.VERSION2)
client.connect("localhost", 1883)
client.subscribe("ogn/TestJP/aircraft/+/position")
client.on_message = on_message
client.loop_forever()
```

### 5.3 Node.js クライアント例

```javascript
const mqtt = require('mqtt');
const client = mqtt.connect('mqtt://localhost:1883');

client.on('connect', () => {
  client.subscribe('ogn/TestJP/aircraft/+/position');
});

client.on('message', (topic, message) => {
  const data = JSON.parse(message.toString());
  const deviceId = topic.split('/')[3];
  console.log(`${deviceId}: ${data.latitude}, ${data.longitude} @ ${data.altitude_m}m`);
});
```

---

## 6. 運用情報

### 6.1 サービス管理

```bash
# サービスの状態確認
sudo systemctl status ogn-mqtt

# 再起動
sudo systemctl restart ogn-mqtt

# ログ確認
journalctl -u ogn-mqtt -f

# Mosquitto ブローカーの状態
sudo systemctl status mosquitto
```

### 6.2 データフロー監視

```bash
# MQTT メッセージレートの確認
mosquitto_sub -h localhost -t '$SYS/broker/messages/received' -v
mosquitto_sub -h localhost -t '$SYS/broker/clients/connected' -v
```

### 6.3 設定パラメータ

`ogn-mqtt.py` 先頭の定数で変更可能:

| パラメータ | デフォルト | 説明 |
|-----------|----------|------|
| `OGN_DECODE_HOST` | `localhost` | ogn-decode ホスト |
| `OGN_DECODE_PORT` | `8083` | ogn-decode HTTP ポート |
| `MQTT_BROKER` | `localhost` | MQTT ブローカーホスト |
| `MQTT_PORT` | `1883` | MQTT ブローカーポート |
| `MQTT_BASE_TOPIC` | `ogn` | ベーストピック |
| `RECEIVER_ID` | `TestJP` | レシーバー識別子 |
| `POLL_INTERVAL` | `2` | ポーリング間隔 (秒) |
| `POSITION_RETAIN` | `false` | 位置メッセージの retain |
| `STATUS_RETAIN` | `true` | ステータスメッセージの retain |

### 6.4 依存サービス

```
mosquitto.service ← ogn-mqtt.service → rtlsdr-ogn.service
```

起動順序: `rtlsdr-ogn` → `mosquitto` → `ogn-mqtt`

---

## 7. 飛行時に追加で得られる情報

静止中の FLARM では GPS ノイズ程度の変動しか見られないが、飛行中は以下のフィールドが有意なデータとなる:

### 7.1 飛行追跡

| フィールド | 飛行時の意味 | 典型値 |
|-----------|-------------|--------|
| `ground_speed_ms` | 対地速度 | 20〜80 m/s (72〜288 km/h) |
| `heading_deg` | 飛行方向 | 安定した方位 |
| `climb_rate_ms` | バリオメーター | -5〜+5 m/s (サーマル時) |
| `turn_rate_degs` | 旋回率 | ±6 deg/s (サーマル旋回時) |
| `altitude_m` | 飛行高度 | 数百〜数千 m |

### 7.2 受信品質

| フィールド | 飛行時の意味 | 典型値 |
|-----------|-------------|--------|
| `distance_km` | 受信距離 | 0〜100+ km |
| `bearing_deg` | 機体方位 | 安定した値 |
| `elevation_deg` | 仰角 | 1〜10° (遠方) |
| `snr_db` | 受信 SNR | 10〜30 dB (距離に依存) |
| `bit_errors` | デコードエラー | 0〜6 (弱信号時に増加) |

### 7.3 複数航空機

飛行場周辺やコンペティション時は `aircraft` トピックの `count` が増加し、複数の航空機を同時に追跡できる。各航空機は個別の `device_id` トピックに分離される。

---

## 8. 制限事項

1. **ポーリング方式**: ogn-decode の HTTP エンドポイントを 2 秒間隔でポーリングするため、最大 2 秒の遅延がある
2. **重複排除**: `timestamp_sod` ベースの重複排除を行うが、ogn-decode が同一タイムスタンプで異なるデータを出す可能性がある
3. **認証なし**: ローカルネットワーク向け設計。外部公開時は Mosquitto の認証・TLS 設定が必要
4. **Retain の注意**: `aircraft/{device_id}/status` は retain されるため、航空機が受信範囲外に出ても最後のステータスが残る

---

---

## 9. ADS-B データ配信 (adsb-poller)

### 9.1 概要

`adsb-poller.py` は tar1090 / dump1090 の `aircraft.json` を定期的にポーリングし、ADS-B / Mode-S / Mode-C データを MQTT に配信する。FLARM 配信 (`ogn-mqtt.py`) と並行動作する。

### 9.2 ADS-B 位置レポート

**トピック**: `ogn/{receiver_id}/aircraft/{ADSB_HEXID}/position`
**device_id 形式**: `ADSB` + ICAO hex ID (例: `ADSB3C4B26`)

位置レポートのスキーマは 3.1 と同一だが、以下の ADS-B 固有フィールドが追加される:

| フィールド | 型 | 説明 |
|-----------|------|------|
| `adsb` | boolean | 常に `true` |
| `adsb_mode` | string | `"adsb"` (ADS-B) または `"modes"` (Mode-S/C) |
| `has_position` | boolean | 位置情報の有無 |
| `flight` | string | フライト番号 / コールサイン |
| `hex` | string | ICAO hex アドレス |
| `squawk` | string | スコーク |
| `category` | string | エミッターカテゴリ |

### 9.3 ADS-B 航空機リスト (集約)

**トピック**: `ogn/{receiver_id}/aircraft_adsb`
**QoS**: 1 | **Retain**: Yes

```json
{
  "timestamp_utc": "2026-03-20T05:30:00+00:00",
  "count": 12,
  "aircraft": [
    {
      "device_id": "ADSB3C4B26",
      "packets_received": 1,
      "latest_position": { "..." },
      "adsb": true
    }
  ],
  "adsb": true
}
```

`adsb: true` フラグにより FLARM リスト (`aircraft`) と区別される。位置不明の機体 (`has_position: false`) もリストに含まれる。

### 9.4 ADS-B 機体分類

| tar1090 type フィールド | 分類 | 説明 |
|------------------------|------|------|
| `adsb_icao`, `adsb_icao_nt`, `tisb_icao`, `tisb_trackfile` | `adsb` | ADS-B / TIS-B |
| `mode_s`, `mlat`, `adsc`, その他 | `modes` | Mode-S / Mode-C / MLAT |

---

*本仕様はレシーバー TestJP (日本 922.4 MHz) の実データに基づいて作成。v2.0 で ADS-B 配信を追加。*
