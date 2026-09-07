#!/usr/bin/env python3
"""SkyLens → OGN (APRS-IS) アップローダ

SkyLens 本体には OGN へ送る機能が無いので、skylens-mqtt.py が MQTT に流した
位置を APRS-IS 形式に組み立てて aprs.glidernet.org へ送る。

UDP を直接読まずに MQTT を購読するのは次の理由による:
  * UDP 8001 を掴めるプロセスは 1 つだけ。ブリッジと取り合いになる
  * ブリッジ側で破損メッセージを除去済みなので、壊れた位置を OGN に流さずに済む

アップロードの ON/OFF は upload-config.json の enabled で切り替える。
ファイルは 5 秒ごとに読み直すので、サービスを再起動しなくても効く。
"""

import argparse
import json
import logging
import math
import os
import re
import signal
import socket
import sys
import threading
import time
from datetime import datetime, timezone

import paho.mqtt.client as mqtt

MQTT_BROKER = "localhost"
MQTT_PORT = 1883
MQTT_BASE_TOPIC = "ogn"

APRS_HOST = "aprs.glidernet.org"
APRS_PORT = 14580
APP_NAME = "FEELDSCOPE-SkyLens"
APP_VERSION = "1.0"

UPLOAD_CONFIG = "/home/pi/FEELDSCOPE/upload-config.json"
CONFIG_RELOAD_SEC = 5
BEACON_INTERVAL_SEC = 300
# 同じ機体を送る最短間隔。OGN の慣行に合わせて 1 位置/秒までに抑える
MIN_SEND_INTERVAL_SEC = 1.0

# OGN の device_id プレフィックス → APRS の address type
ADDR_TYPE = {"RND": 0, "ICA": 1, "FLR": 2, "GEN": 3, "EXT": 0}

# 機種名 → OGN aircraft type コード (FTD-092 の TargetType と同じ並び)
ACFT_TYPE = {
    "Glider": 1, "Tow Plane": 2, "Helicopter": 3, "Parachute": 4,
    "Drop Plane": 5, "Hang Glider": 6, "Paraglider": 7,
    "Powered Aircraft": 8, "Jet Aircraft": 9, "Unknown": 10,
    "Balloon": 11, "Airship": 12, "UAV": 13, "Static Object": 15,
}

log = logging.getLogger("skylens-aprs")


def aprs_passcode(callsign):
    """APRS-IS の標準パスコード。OGN もこれを受け付ける。"""
    call = callsign.split("-")[0].upper()
    code = 0x73E2
    i = 0
    while i < len(call):
        code ^= ord(call[i]) << 8
        if i + 1 < len(call):
            code ^= ord(call[i + 1])
        i += 2
    return code & 0x7FFF


def dm(value, is_lat):
    """度 → APRS の度分形式 (ddmm.mmN)。"""
    hemi = ("N" if value >= 0 else "S") if is_lat else ("E" if value >= 0 else "W")
    v = abs(value)
    deg = int(v)
    minutes = (v - deg) * 60.0
    width = 2 if is_lat else 3
    return "%0*d%05.2f%s" % (width, deg, minutes, hemi), minutes


def precision_digits(lat_min, lon_min):
    """!W..! 拡張精度 (度分の小数第 3・4 位)。"""
    a = int(round(lat_min * 1000)) % 10
    b = int(round(lon_min * 1000)) % 10
    return "!W%d%d!" % (a, b)


def load_upload_config(path):
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        return bool(data.get("enabled", False))
    except (OSError, ValueError):
        return False


class AprsUploader:

    def __init__(self, args):
        self.args = args
        self.receiver_id = args.receiver_id
        self.sock = None
        self.lock = threading.Lock()
        self.enabled = load_upload_config(args.upload_config)
        self.last_config_check = 0.0
        self.last_beacon = 0.0
        self.last_sent = {}
        self.station = {"latitude": None, "longitude": None, "altitude_m": 0.0}
        self.sent_count = 0
        self.drop_count = 0
        self.sent_last_min = 0
        self.last_error = None
        self.login_response = None
        self.connected_to = None
        self.started_at = datetime.now(timezone.utc).isoformat()
        self.last_sent_at = None
        self.client = None

    # -- APRS-IS 接続 --------------------------------------------------------

    def connect_aprs(self):
        if self.sock is not None:
            return True
        try:
            s = socket.create_connection((self.args.host, self.args.port), timeout=15)
            s.settimeout(15)
            banner = s.recv(512).decode("utf-8", "replace").strip()
            log.info("APRS-IS 応答: %s", banner)
            login = "user %s pass %d vers %s %s\r\n" % (
                self.receiver_id, aprs_passcode(self.receiver_id),
                APP_NAME, APP_VERSION)
            s.sendall(login.encode("ascii", "replace"))
            resp = s.recv(512).decode("utf-8", "replace").strip()
            log.info("APRS-IS ログイン: %s", resp)
            self.login_response = resp
            if "unverified" in resp.lower():
                log.error("ログインが unverified です。送信は受け付けられません")
                self.last_error = "ログインが unverified です"
            self.sock = s
            self.connected_to = "%s:%d" % (self.args.host, self.args.port)
            self.last_error = None if "unverified" not in resp.lower() else self.last_error
            return True
        except OSError as exc:
            log.warning("APRS-IS 接続失敗: %s", exc)
            self.last_error = "接続失敗: %s" % exc
            self.sock = None
            self.connected_to = None
            return False

    def disconnect_aprs(self, reason=""):
        if self.sock is not None:
            try:
                self.sock.close()
            except OSError:
                pass
            self.sock = None
            self.connected_to = None
            if reason:
                log.info("APRS-IS 切断: %s", reason)

    def send_line(self, line):
        with self.lock:
            if not self.connect_aprs():
                return False
            try:
                self.sock.sendall((line + "\r\n").encode("utf-8", "replace"))
                self.sent_count += 1
                self.last_sent_at = datetime.now(timezone.utc).isoformat()
                return True
            except OSError as exc:
                self.last_error = "送信エラー: %s" % exc
                self.disconnect_aprs("送信エラー: %s" % exc)
                return False

    # -- パケット組み立て ----------------------------------------------------

    def build_position(self, device_id, pos):
        lat, lon = pos.get("latitude"), pos.get("longitude")
        if lat is None or lon is None:
            return None

        prefix = device_id[:3].upper()
        address = device_id[3:].upper()
        if not re.fullmatch(r"[0-9A-F]{6}", address):
            return None
        addr_type = ADDR_TYPE.get(prefix, 0)

        ts = pos.get("timestamp_utc")
        try:
            dt = datetime.fromisoformat(ts.replace("Z", "+00:00")) if ts else None
        except ValueError:
            dt = None
        if dt is None:
            dt = datetime.now(timezone.utc)
        timestr = dt.astimezone(timezone.utc).strftime("%H%M%S") + "h"

        lat_s, lat_min = dm(lat, True)
        lon_s, lon_min = dm(lon, False)

        course = int(round(pos.get("heading_deg") or 0)) % 360
        speed_kt = int(round((pos.get("ground_speed_ms") or 0.0) * 1.943844))
        alt_ft = int(round((pos.get("altitude_m") or 0.0) * 3.280840))

        acft_code = ACFT_TYPE.get(pos.get("aircraft_type") or "", 10)
        flags = ((1 if pos.get("no_tracking") else 0) << 7
                 | (1 if pos.get("stealth") else 0) << 6
                 | (acft_code & 0x0F) << 2
                 | (addr_type & 0x03))

        climb_fpm = int(round((pos.get("climb_rate_ms") or 0.0) * 196.850394))
        rot = (pos.get("turn_rate_degs") or 0.0) / 3.0        # OGN は half-turn/min
        signal_db = pos.get("signal_db") or 0.0
        freq_khz = pos.get("freq_offset_khz") or 0.0

        body = ("/%s%s/%s'%03d/%03d/A=%06d %s id%02X%s %+dfpm %+.1frot %.1fdB 0e %+.1fkHz"
                % (timestr, lat_s, lon_s, course, speed_kt, alt_ft,
                   precision_digits(lat_min, lon_min), flags, address,
                   climb_fpm, rot, signal_db, freq_khz))
        return "%s%s>OGNSKY,qAS,%s:%s" % (prefix, address, self.receiver_id, body)

    def build_beacon(self):
        lat, lon = self.station.get("latitude"), self.station.get("longitude")
        if lat is None or lon is None:
            return None
        dt = datetime.now(timezone.utc)
        timestr = dt.strftime("%H%M%S") + "h"
        lat_s, _ = dm(lat, True)
        lon_s, _ = dm(lon, False)
        alt_ft = int(round((self.station.get("altitude_m") or 0.0) * 3.280840))
        comment = ("v%s %s SkyLens" % (APP_VERSION, APP_NAME))
        return ("%s>OGNSKY,TCPIP*,qAC,GLIDERN1:/%s%sI%s&/A=%06d %s"
                % (self.receiver_id, timestr, lat_s, lon_s, alt_ft, comment))

    # -- MQTT ---------------------------------------------------------------

    def on_connect(self, client, userdata, flags, rc, properties=None):
        if rc == 0:
            client.subscribe("%s/%s/aircraft/+/position" % (MQTT_BASE_TOPIC, self.receiver_id))
            client.subscribe("%s/%s/status" % (MQTT_BASE_TOPIC, self.receiver_id))
            log.info("MQTT 購読開始 (receiver_id=%s)", self.receiver_id)
        else:
            log.error("MQTT 接続失敗: rc=%s", rc)

    def on_message(self, client, userdata, msg):
        try:
            data = json.loads(msg.payload.decode("utf-8", "replace"))
        except ValueError:
            return
        parts = msg.topic.split("/")

        if parts[-1] == "status" and len(parts) == 3:
            p = data.get("position") or {}
            if p.get("latitude") is not None:
                self.station = {
                    "latitude": p.get("latitude"),
                    "longitude": p.get("longitude"),
                    "altitude_m": p.get("altitude_m") or 0.0,
                }
            return

        if len(parts) != 5 or parts[-1] != "position":
            return
        # SkyLens 由来の位置だけを上げる。OGN 受信中は ogn-decode 自身が送るため
        if data.get("source") != "skylens":
            return
        if not self.enabled:
            return
        if data.get("no_tracking") or data.get("stealth"):
            self.drop_count += 1
            return

        device_id = parts[3]
        now = time.time()
        if now - self.last_sent.get(device_id, 0.0) < MIN_SEND_INTERVAL_SEC:
            return
        line = self.build_position(device_id, data)
        if line and self.send_line(line):
            self.last_sent[device_id] = now
            log.debug("APRS 送信: %s", line)

    def publish_status(self):
        """ステータス画面が読む送信状態。UI から見えないと止まっていても気付けない。"""
        if self.client is None:
            return
        payload = {
            "source": "skylens",
            "timestamp_utc": datetime.now(timezone.utc).isoformat(),
            "enabled": self.enabled,
            "connected": self.sock is not None,
            "server": "%s:%d" % (self.args.host, self.args.port),
            "connected_to": self.connected_to,
            "callsign": self.receiver_id,
            "login_response": self.login_response,
            "sent_total": self.sent_count,
            "sent_last_min": self.sent_last_min,
            "dropped_private": self.drop_count,
            "aircraft_sent": len(self.last_sent),
            "last_sent_utc": self.last_sent_at,
            "last_error": self.last_error,
            "started_at_utc": self.started_at,
        }
        self.client.publish("%s/%s/aprs_status" % (MQTT_BASE_TOPIC, self.receiver_id),
                            json.dumps(payload, ensure_ascii=False), qos=1, retain=True)

    # -- メインループ --------------------------------------------------------

    def run(self):
        client = mqtt.Client(
            client_id="skylens-aprs-%s" % self.receiver_id,
            callback_api_version=mqtt.CallbackAPIVersion.VERSION2,
        )
        client.on_connect = self.on_connect
        client.on_message = self.on_message
        client.will_set("%s/%s/aprs_status" % (MQTT_BASE_TOPIC, self.receiver_id),
                        payload=json.dumps({"source": "skylens", "enabled": False,
                                            "connected": False,
                                            "last_error": "アップローダが停止しました"}),
                        qos=1, retain=True)
        client.connect(MQTT_BROKER, MQTT_PORT, keepalive=60)
        client.loop_start()
        self.client = client

        self._running = True
        log.info("アップロード: %s", "有効" if self.enabled else "無効")
        last_report = time.time()
        last_status_pub = 0.0
        last_sent_count = 0
        while self._running:
            time.sleep(1.0)
            now = time.time()

            if now - last_status_pub >= 10:
                self.publish_status()
                last_status_pub = now

            # 1 分ごとに送信状況を残す。無言だと「本当に送れているのか」が判らないため
            if now - last_report >= 60:
                self.sent_last_min = self.sent_count - last_sent_count
                log.info("直近1分: %d 件送信 (累計 %d 件, 非公開設定で除外 %d 件, 機体 %d)",
                         self.sent_last_min, self.sent_count,
                         self.drop_count, len(self.last_sent))
                last_sent_count = self.sent_count
                last_report = now

            if now - self.last_config_check >= CONFIG_RELOAD_SEC:
                self.last_config_check = now
                new_enabled = load_upload_config(self.args.upload_config)
                if new_enabled != self.enabled:
                    self.enabled = new_enabled
                    log.info("アップロードを %s にしました",
                             "有効" if new_enabled else "無効")
                    if not new_enabled:
                        self.disconnect_aprs("アップロード無効化")

            if self.enabled and now - self.last_beacon >= BEACON_INTERVAL_SEC:
                beacon = self.build_beacon()
                if beacon and self.send_line(beacon):
                    self.last_beacon = now
                    log.info("受信機ビーコンを送信しました")
                elif beacon is None:
                    # 局位置がまだ来ていない。次の周回で再試行する
                    pass

        self.enabled = False
        self.disconnect_aprs("終了")
        self.publish_status()
        time.sleep(0.3)
        client.loop_stop()
        client.disconnect()

    def shutdown(self):
        self._running = False


def detect_receiver_id():
    for path, pattern in (("/boot/OGN-receiver.conf", r'ReceiverName="?([^"#\s]+)'),
                          ("/home/pi/rtlsdr-ogn.conf", r'Call\s*=\s*"([^"]+)"')):
        try:
            with open(path, "r", encoding="utf-8") as f:
                m = re.search(pattern, f.read())
            if m and m.group(1):
                return m.group(1)
        except OSError:
            continue
    return "SkyLensReceiver"


def main():
    ap = argparse.ArgumentParser(description="SkyLens の受信データを OGN へ送る")
    ap.add_argument("--receiver-id", default=None)
    ap.add_argument("--host", default=APRS_HOST)
    ap.add_argument("--port", type=int, default=APRS_PORT)
    ap.add_argument("--upload-config", default=UPLOAD_CONFIG)
    ap.add_argument("--verbose", action="store_true")
    args = ap.parse_args()

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
    )
    if not args.receiver_id:
        args.receiver_id = detect_receiver_id()

    uploader = AprsUploader(args)

    def shutdown(signum, frame):
        log.info("シグナル %s を受信、終了します", signum)
        uploader.shutdown()

    signal.signal(signal.SIGTERM, shutdown)
    signal.signal(signal.SIGINT, shutdown)
    uploader.run()
    return 0


if __name__ == "__main__":
    sys.exit(main())
