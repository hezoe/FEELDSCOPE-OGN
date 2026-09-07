#!/usr/bin/env python3
"""SkyLens → MQTT ブリッジ

SkyLens が UDP で吐く JSON (FTD-092) を、ogn-mqtt.py と同一のトピック・
同一スキーマで MQTT に流す。これにより地図・機体DB・フライトログは
OGN 受信時と全く同じコードで SkyLens のデータを扱える。

  ogn/<receiver_id>/aircraft                     機体一覧 (retain)
  ogn/<receiver_id>/aircraft/<device_id>/position  位置1件ごと
  ogn/<receiver_id>/aircraft/<device_id>/status    機体サマリ (retain)
  ogn/<receiver_id>/status                       受信機ステータス (retain)

SkyLens 固有の注意点 (2026-09-01 の実機検証で判明):
  * 破損した traffic が正常メッセージとして出てくる (実測 0.29%)。品質フラグも
    無いので、消費側で弾く以外に手が無い。→ is_corrupt() で除去する。
  * dBm はゲイン補正されていない。OGN の snr_db とは別物なので signal_db に
    そのまま入れ、snr_db は 0 とする。
  * pos.alt は楕円体高。OGN の altitude_m は標高なのでジオイド高を引く。
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
import time
from datetime import datetime, timezone

import paho.mqtt.client as mqtt

# ---------------------------------------------------------------------------
# 定数
# ---------------------------------------------------------------------------
MQTT_BROKER = "localhost"
MQTT_PORT = 1883
MQTT_BASE_TOPIC = "ogn"

SKYLENS_CONFIG = "/home/pi/skylens/config.yml"
OGN_RECEIVER_CONF = "/boot/OGN-receiver.conf"
RTLSDR_OGN_CONF = "/home/pi/rtlsdr-ogn.conf"

# 機体を一覧から落とすまでの無通信時間
AIRCRAFT_TIMEOUT_SEC = 300
# 機体一覧・サマリの publish 間隔 (ogn-mqtt に合わせる)
LIST_INTERVAL_SEC = 2
# 受信機ステータスの publish 間隔
STATUS_INTERVAL_SEC = 10

# FTD-092 TargetType → OGN 互換の機種名/コード
TARGET_TYPE = {
    0: ("Unknown", "?"),
    1: ("Glider", "G"),
    2: ("Tow Plane", "T"),
    3: ("Helicopter", "H"),
    4: ("Parachute", "P"),
    5: ("Drop Plane", "D"),
    6: ("Hang Glider", "g"),
    7: ("Paraglider", "p"),
    8: ("Powered Aircraft", "F"),
    9: ("Jet Aircraft", "J"),
    10: ("Unknown", "?"),
    11: ("Balloon", "B"),
    12: ("Airship", "A"),
    13: ("UAV", "U"),
    15: ("Static Object", "S"),
}

# FTD-092 Identifier の種別 → OGN の device_id プレフィックスと address_type
ID_KIND = {
    "icao": ("ICA", 1),
    "flarm": ("FLR", 2),
    "random": ("RND", 3),
    "gen": ("GEN", 4),
}

log = logging.getLogger("skylens-mqtt")


# ---------------------------------------------------------------------------
# 設定の読み取り
# ---------------------------------------------------------------------------

def read_skylens_config(path):
    """SkyLens の config.yml から必要な値だけ拾う。

    PyYAML に依存したくないので、station.position と output.udp.port だけを
    素朴に読む。値はすべて単純なスカラなのでこれで足りる。
    """
    cfg = {"station_id": "", "latitude": None, "longitude": None,
           "altitude": None, "udp_port": 8001, "udp_address": "127.0.0.1"}
    try:
        with open(path, "r", encoding="utf-8") as f:
            text = f.read()
    except OSError:
        return cfg

    # コメントを落としてから拾う (値の後ろに # コメントが付く)
    def grab(pattern, cast, default=None):
        m = re.search(pattern, text, re.MULTILINE)
        if not m:
            return default
        try:
            return cast(m.group(1))
        except (TypeError, ValueError):
            return default

    cfg["station_id"] = grab(r"^\s*id:\s*([^\s#]+)", str, "") or ""
    cfg["latitude"] = grab(r"^\s*latitude:\s*([+\-\d.]+)", float)
    cfg["longitude"] = grab(r"^\s*longitude:\s*([+\-\d.]+)", float)
    cfg["altitude"] = grab(r"^\s*altitude:\s*([+\-\d.]+)", float)
    cfg["udp_port"] = grab(r"^\s*port:\s*(\d+)", int, 8001)
    return cfg


def detect_receiver_id(fallback):
    """webapp が購読する receiver_id と一致させる。

    webapp の detectReceiverId() は /boot/OGN-receiver.conf の ReceiverName を
    見るので、SkyLens モードでも同じ値を使わないと地図に出ない。
    """
    try:
        with open(OGN_RECEIVER_CONF, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line.startswith("ReceiverName="):
                    val = line.split("=", 1)[1].split("#")[0].strip().strip('"').strip("'")
                    if val:
                        return val
    except OSError:
        pass
    try:
        with open(RTLSDR_OGN_CONF, "r", encoding="utf-8") as f:
            for line in f:
                m = re.search(r'Call\s*=\s*"([^"]+)"', line)
                if m and m.group(1):
                    return m.group(1)
    except OSError:
        pass
    return fallback or "SkyLensReceiver"


# ---------------------------------------------------------------------------
# 幾何計算
# ---------------------------------------------------------------------------

EARTH_R = 6371000.0


def haversine_m(lat0, lon0, lat, lon):
    dlat = math.radians(lat - lat0)
    dlon = math.radians(lon - lon0)
    a = (math.sin(dlat / 2) ** 2
         + math.cos(math.radians(lat0)) * math.cos(math.radians(lat))
         * math.sin(dlon / 2) ** 2)
    return EARTH_R * 2 * math.asin(math.sqrt(a))


def bearing_deg(lat0, lon0, lat, lon):
    p0, p1 = math.radians(lat0), math.radians(lat)
    dl = math.radians(lon - lon0)
    y = math.sin(dl) * math.cos(p1)
    x = math.cos(p0) * math.sin(p1) - math.sin(p0) * math.cos(p1) * math.cos(dl)
    return (math.degrees(math.atan2(y, x)) + 360.0) % 360.0


def elevation_deg(dist_m, dalt_m):
    if dist_m <= 0:
        return 90.0 if dalt_m > 0 else 0.0
    return math.degrees(math.atan2(dalt_m, dist_m))


# ---------------------------------------------------------------------------
# 破損メッセージの判定
# ---------------------------------------------------------------------------

def structural_faults(traffic):
    """単体で物理的にあり得ない値を検出する。"""
    faults = []
    mov = traffic.get("mov") or {}
    pos = traffic.get("pos") or {}

    v = mov.get("track")
    if v is not None and not (0 <= v <= 360):
        faults.append("track=%s" % v)
    v = mov.get("climb")
    if v is not None and abs(v) > 30:
        faults.append("climb=%s" % v)
    v = mov.get("speed")
    if v is not None and not (0 <= v <= 120):
        faults.append("speed=%s" % v)
    v = mov.get("turn")
    if v is not None and abs(v) > 30:
        faults.append("turn=%s" % v)
    v = pos.get("alt")
    if v is not None and not (-100 <= v <= 15000):
        faults.append("alt=%s" % v)
    lat, lon = pos.get("lat"), pos.get("lon")
    if lat is not None and not (-90 <= lat <= 90):
        faults.append("lat=%s" % lat)
    if lon is not None and not (-180 <= lon <= 180):
        faults.append("lon=%s" % lon)
    return faults


# ---------------------------------------------------------------------------
# SkyLens → OGN スキーマ変換
# ---------------------------------------------------------------------------

def device_id_of(ident):
    """FTD-092 の Identifier を OGN 形式の device_id にする。

    id.icao=8652127 → "ICA84055F" のように、既存の機体DBのキーと一致する。
    """
    if not isinstance(ident, dict):
        return None, 0, ""
    for kind, (prefix, addr_type) in ID_KIND.items():
        if kind in ident and ident[kind] is not None:
            try:
                addr = "%06X" % int(ident[kind])
            except (TypeError, ValueError):
                continue
            return prefix + addr, addr_type, addr
    ext = ident.get("ext")
    if ext:
        safe = re.sub(r"[^0-9A-Za-z_-]", "", str(ext))[:16]
        if safe:
            return "EXT" + safe.upper(), 0, safe.upper()
    return None, 0, ""


def split_flight_id(flight_id):
    """FLARM の flightId を登録記号とコンテストナンバーに振り分ける。

    FLARM の Flight ID は 1 本の文字列でしか来ない。3 文字以下なら
    コンテストナンバー、それ以上なら登録記号として扱う。どちらか片方しか
    埋まらないが、地図側は機体DBを登録記号でも引けるので実用上これで足りる。
    """
    if not flight_id:
        return None, None
    s = str(flight_id).strip().upper()
    if not s:
        return None, None
    compact = s.replace("-", "").replace(" ", "")
    if len(compact) <= 3:
        return None, s          # コンテストナンバー
    return s, None              # 登録記号


class Aircraft:
    """1 機ぶんの受信状態。"""

    __slots__ = ("device_id", "address", "address_type", "packets", "first_seen",
                 "last_seen", "last_fix", "flight_id", "glider_id", "competition_id",
                 "part_number", "sw_version", "aircraft_type", "aircraft_type_code",
                 "stealth", "no_tracking", "dbm_sum", "dbm_n", "freq_offset_khz",
                 "speed_sum", "speed_n", "latest_position", "dirty")

    def __init__(self, device_id, address, address_type):
        self.device_id = device_id
        self.address = address
        self.address_type = address_type
        self.packets = 0
        self.first_seen = time.time()
        self.last_seen = self.first_seen
        self.last_fix = None            # (time, lat, lon)
        self.flight_id = None
        self.glider_id = None
        self.competition_id = None
        self.part_number = None
        self.sw_version = None
        self.aircraft_type = None
        self.aircraft_type_code = None
        self.stealth = False
        self.no_tracking = False
        self.dbm_sum = 0.0
        self.dbm_n = 0
        self.speed_sum = 0.0
        self.speed_n = 0
        self.freq_offset_khz = 0.0
        self.latest_position = None
        self.dirty = False

    def summary(self):
        avg_dbm = (self.dbm_sum / self.dbm_n) if self.dbm_n else 0.0
        avg_speed = (self.speed_sum / self.speed_n) if self.speed_n else 0.0
        s = {
            "device_id": self.device_id,
            "packets_received": self.packets,
            "last_seen_sec": int(time.time() - self.last_seen),
            "protocol": 1,
            "address_type": self.address_type,
            "address": self.address,
            "flags": "F*",
            "avg_speed_ms": round(avg_speed, 1),
            "avg_snr_db": 0.0,
            "avg_signal_db": round(avg_dbm, 1),
            "avg_bit_errors": 0.0,
            "freq_offset_khz": round(self.freq_offset_khz, 2),
            "freq_correction_khz": 0.0,
            "source": "skylens",
        }
        if self.glider_id:
            s["glider_id"] = self.glider_id
        if self.competition_id:
            s["competition_id"] = self.competition_id
        if self.flight_id:
            s["flight_id"] = self.flight_id
        if self.part_number:
            s["part_number"] = self.part_number
        if self.sw_version:
            s["sw_version"] = self.sw_version
        return s


class SkyLensBridge:

    def __init__(self, args):
        self.args = args
        cfg = read_skylens_config(args.skylens_config)
        self.station_lat = args.latitude if args.latitude is not None else cfg["latitude"]
        self.station_lon = args.longitude if args.longitude is not None else cfg["longitude"]
        station_alt_hae = args.altitude if args.altitude is not None else cfg["altitude"]
        self.geoid = args.geoid_separation
        # 局の標高 (MSL)。config.yml の altitude は楕円体高なのでジオイド高を引く
        self.station_alt_msl = ((station_alt_hae - self.geoid)
                                if station_alt_hae is not None else 0.0)
        self.station_id = cfg["station_id"] or "SkyLens"
        self.receiver_id = args.receiver_id or detect_receiver_id(self.station_id)
        self.udp_port = args.udp_port or cfg["udp_port"]

        if self.station_lat is None or self.station_lon is None:
            log.warning("局位置が読めません。距離・方位は 0 で出力します")

        self.aircraft = {}
        self.stats = {}
        self.protocol_version = None
        self.corrupt_count = 0
        self.traffic_count = 0
        self.started_at = time.time()
        self.last_list_pub = 0.0
        self.last_status_pub = 0.0

        self.client = mqtt.Client(
            client_id="skylens-mqtt-%s" % self.receiver_id,
            callback_api_version=mqtt.CallbackAPIVersion.VERSION2,
        )
        self.client.will_set(
            "%s/%s/status" % (MQTT_BASE_TOPIC, self.receiver_id),
            payload=json.dumps({"online": False, "source": "skylens"}),
            qos=1, retain=True,
        )
        self._connected = False
        self.client.on_connect = self._on_connect
        self.client.on_disconnect = self._on_disconnect

    # -- MQTT ---------------------------------------------------------------

    def _on_connect(self, client, userdata, flags, rc, properties=None):
        if rc == 0:
            log.info("MQTT に接続しました")
            self._connected = True
        else:
            log.error("MQTT 接続失敗: rc=%s", rc)

    def _on_disconnect(self, client, userdata, flags, rc, properties=None):
        log.warning("MQTT 切断: rc=%s", rc)
        self._connected = False

    def connect(self):
        self.client.connect(MQTT_BROKER, MQTT_PORT, keepalive=60)
        self.client.loop_start()

    def stop(self):
        self._publish("%s/%s/status" % (MQTT_BASE_TOPIC, self.receiver_id),
                      {"receiver_id": self.receiver_id, "online": False,
                       "source": "skylens",
                       "timestamp_utc": datetime.now(timezone.utc).isoformat()},
                      retain=True, qos=1)
        time.sleep(0.3)
        self.client.loop_stop()
        self.client.disconnect()

    def _publish(self, topic, payload, retain=False, qos=0):
        self.client.publish(topic, json.dumps(payload, ensure_ascii=False),
                            qos=qos, retain=retain)

    # -- メッセージ処理 ------------------------------------------------------

    def handle(self, obj):
        if "traffic" in obj:
            self.handle_traffic(obj["traffic"])
        elif "info" in obj:
            self.handle_info(obj["info"])
        elif "statistics" in obj:
            self.stats = obj["statistics"]
        elif "heartbeat" in obj:
            hb = obj["heartbeat"] or {}
            self.protocol_version = (hb.get("protocol") or {}).get("version")
            sysid = (hb.get("system") or {}).get("id")
            if sysid:
                self.station_id = sysid

    def handle_info(self, info):
        """info メッセージ = 送信側の登録記号 / コンテストナンバー等。"""
        device_id, addr_type, addr = device_id_of(info.get("id"))
        if not device_id:
            return
        ac = self.aircraft.get(device_id)
        if ac is None:
            ac = Aircraft(device_id, addr, addr_type)
            self.aircraft[device_id] = ac
        flight_id = info.get("flightId")
        if flight_id:
            reg, cn = split_flight_id(flight_id)
            ac.flight_id = str(flight_id).strip()
            if reg:
                ac.glider_id = reg
            if cn:
                ac.competition_id = cn
            log.info("info: %s flightId=%r → 登録記号=%r CN=%r",
                     device_id, ac.flight_id, ac.glider_id, ac.competition_id)
        if info.get("partNumber"):
            ac.part_number = str(info["partNumber"])
        if info.get("swVersion"):
            ac.sw_version = str(info["swVersion"])
        ac.dirty = True
        # 既に位置を持っているなら、識別情報を載せ直して即座に反映する
        if ac.latest_position:
            self._decorate(ac, ac.latest_position)

    def handle_traffic(self, t):
        self.traffic_count += 1
        device_id, addr_type, addr = device_id_of(t.get("id"))
        if not device_id:
            return

        faults = structural_faults(t)
        pos = t.get("pos") or {}
        mov = t.get("mov") or {}
        tm = t.get("time")
        lat, lon = pos.get("lat"), pos.get("lon")

        ac = self.aircraft.get(device_id)

        # 位置の飛び: 同一機体の直前の正常な位置から、あり得ない速度で動いていないか。
        # 距離そのものでは判定しない (本当に遠方の機体が居るため)。
        if (not faults and ac is not None and ac.last_fix and tm is not None
                and lat is not None and lon is not None):
            t0, la0, lo0 = ac.last_fix
            dt = tm - t0
            if 0 < dt < 120:
                d = haversine_m(la0, lo0, lat, lon)
                if d / dt > self.args.max_jump_speed:
                    faults.append("位置飛び %.0fm/%.1fs = %.0fm/s" % (d, dt, d / dt))

        if faults:
            self.corrupt_count += 1
            log.warning("破損メッセージを破棄: %s %s", device_id, ", ".join(faults))
            return

        if lat is None or lon is None:
            return

        if ac is None:
            ac = Aircraft(device_id, addr, addr_type)
            self.aircraft[device_id] = ac

        now = time.time()
        ac.packets += 1
        ac.last_seen = now
        ac.last_fix = (tm, lat, lon) if tm is not None else ac.last_fix

        src_flarm = ((t.get("src") or {}).get("flarm") or {})
        ac.stealth = bool(src_flarm.get("stealth", False))
        ac.no_tracking = bool(src_flarm.get("noTrack", False))

        ttype = t.get("type")
        if ttype in TARGET_TYPE:
            ac.aircraft_type, ac.aircraft_type_code = TARGET_TYPE[ttype]

        rec = (t.get("rec") or [{}])[0]
        gnd = rec.get("gnd") or rec.get("rad") or {}
        dbm = gnd.get("dBm")
        if dbm is not None:
            ac.dbm_sum += float(dbm)
            ac.dbm_n += 1
        dev = gnd.get("dev")
        if dev is not None:
            try:
                ac.freq_offset_khz = float(dev) / 1000.0
            except (TypeError, ValueError):
                pass

        speed = mov.get("speed")
        if speed is not None:
            ac.speed_sum += float(speed)
            ac.speed_n += 1

        position = self._build_position(ac, t, tm, lat, lon, pos, mov, dbm)
        ac.latest_position = position
        ac.dirty = True

        self._publish("%s/%s/aircraft/%s/position"
                      % (MQTT_BASE_TOPIC, self.receiver_id, device_id),
                      position, retain=False, qos=0)

    def _build_position(self, ac, t, tm, lat, lon, pos, mov, dbm):
        if tm is not None:
            dt_utc = datetime.fromtimestamp(tm, tz=timezone.utc)
        else:
            dt_utc = datetime.now(timezone.utc)
        sod = dt_utc.hour * 3600 + dt_utc.minute * 60 + dt_utc.second

        # pos.alt は楕円体高。OGN の altitude_m は標高なのでジオイド高を引く
        alt_hae = pos.get("alt")
        alt_msl = (float(alt_hae) - self.geoid) if alt_hae is not None else 0.0

        if self.station_lat is not None and self.station_lon is not None:
            dist_m = haversine_m(self.station_lat, self.station_lon, lat, lon)
            brg = bearing_deg(self.station_lat, self.station_lon, lat, lon)
            elev = elevation_deg(dist_m, alt_msl - self.station_alt_msl)
        else:
            dist_m, brg, elev = 0.0, 0.0, 0.0

        on_gnd = bool(mov.get("gnd", False))
        position = {
            "timestamp_utc": dt_utc.isoformat(),
            "timestamp_sod": sod,
            "latitude": round(lat, 7),
            "longitude": round(lon, 7),
            "altitude_m": round(alt_msl, 1),
            "altitude_hae_m": round(float(alt_hae), 1) if alt_hae is not None else None,
            "climb_rate_ms": round(float(mov.get("climb", 0.0)), 1),
            "ground_speed_ms": round(float(mov.get("speed", 0.0)), 1),
            "heading_deg": round(float(mov.get("track", 0.0)), 1),
            "turn_rate_degs": round(float(mov.get("turn", 0.0)), 1),
            "on_ground": on_gnd,
            "stealth": ac.stealth,
            "relay": False,
            "no_tracking": ac.no_tracking,
            "flags_raw": "%s%s" % ("S" if ac.stealth else "_",
                                   "1" if ac.no_tracking else "0"),
            # SkyLens は測位精度を出さないので 0 (未知) とする
            "h_accuracy_m": 0,
            "v_accuracy_m": 0,
            "frame_info": "skylens",
            "freq_offset_khz": round(ac.freq_offset_khz, 2),
            # dBm はゲイン補正されていないため OGN の SNR とは別物。
            # snr_db は使わず signal_db にそのまま入れる。
            "snr_db": 0.0,
            "signal_db": round(float(dbm), 1) if dbm is not None else 0.0,
            "channel_errors": 0,
            "bit_errors": 0,
            "distance_km": round(dist_m / 1000.0, 2),
            "bearing_deg": round(brg, 1),
            "elevation_deg": round(elev, 1),
            "is_latest": True,
            "source": "skylens",
        }
        self._decorate(ac, position)
        return position

    def _decorate(self, ac, position):
        """機体の識別情報 (info 由来) を位置メッセージに載せる。"""
        if ac.aircraft_type:
            position["aircraft_type"] = ac.aircraft_type
            position["aircraft_type_code"] = ac.aircraft_type_code
        if ac.glider_id:
            position["glider_id"] = ac.glider_id
        if ac.competition_id:
            position["competition_id"] = ac.competition_id
        if ac.flight_id:
            position["flight_id"] = ac.flight_id

    # -- 定期 publish --------------------------------------------------------

    def expire(self):
        now = time.time()
        dead = [k for k, ac in self.aircraft.items()
                if now - ac.last_seen > AIRCRAFT_TIMEOUT_SEC]
        for k in dead:
            del self.aircraft[k]
            self._publish("%s/%s/aircraft/%s/status"
                          % (MQTT_BASE_TOPIC, self.receiver_id, k),
                          {}, retain=True, qos=1)
        return bool(dead)

    def publish_list(self):
        entries = []
        for ac in self.aircraft.values():
            entry = ac.summary()
            if ac.latest_position:
                entry["latest_position"] = ac.latest_position
            entries.append(entry)
            if ac.dirty:
                self._publish("%s/%s/aircraft/%s/status"
                              % (MQTT_BASE_TOPIC, self.receiver_id, ac.device_id),
                              entry, retain=True, qos=1)
                ac.dirty = False
        self._publish("%s/%s/aircraft" % (MQTT_BASE_TOPIC, self.receiver_id),
                      {"timestamp_utc": datetime.now(timezone.utc).isoformat(),
                       "count": len(entries),
                       "aircraft": entries,
                       "source": "skylens"},
                      retain=True, qos=1)

    def publish_status(self):
        status = {
            "receiver_id": self.receiver_id,
            "timestamp_utc": datetime.now(timezone.utc).isoformat(),
            "source": "skylens",
            "software": "SkyLens (station %s)" % self.station_id,
            "hostname": socket.gethostname(),
            "position": {
                "latitude": self.station_lat,
                "longitude": self.station_lon,
                "altitude_m": round(self.station_alt_msl, 1),
                "geoid_separation_m": self.geoid,
            },
            "system": read_system_stats(),
            "rf": {"freq_plan": "JAPAN (922.4 MHz)", "input_noise_db": None},
            "skylens": {
                "protocol_version": self.protocol_version,
                "station_id": self.station_id,
                "uptime_ms": self.stats.get("uptimeMs"),
                "preambles_found": self.stats.get("preamblesFound"),
                "packets_decoded": self.stats.get("packetsDecoded"),
                "invalid_packets": self.stats.get("invalidPackets"),
                "traffic_received": self.traffic_count,
                "traffic_rejected": self.corrupt_count,
            },
            "traffic": {
                "last_1m": {"visible": len(self.aircraft), "total": len(self.aircraft)},
            },
            "online": True,
        }
        self._publish("%s/%s/status" % (MQTT_BASE_TOPIC, self.receiver_id),
                      status, retain=True, qos=1)

    # -- メインループ --------------------------------------------------------

    def run(self):
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        sock.bind((self.args.bind, self.udp_port))
        sock.settimeout(1.0)
        log.info("UDP %s:%d を待受、MQTT トピック %s/%s/ へ配信",
                 self.args.bind, self.udp_port, MQTT_BASE_TOPIC, self.receiver_id)
        log.info("局位置: %s, %s 標高 %.0fm (楕円体高からジオイド %.0fm を減算)",
                 self.station_lat, self.station_lon, self.station_alt_msl, self.geoid)

        self._running = True
        while self._running:
            try:
                data, _ = sock.recvfrom(65535)
            except socket.timeout:
                data = None
            except OSError as exc:
                log.error("UDP 受信エラー: %s", exc)
                data = None

            if data:
                for line in data.decode("utf-8", "replace").splitlines():
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        obj = json.loads(line)
                    except ValueError:
                        log.debug("JSON として読めない行を無視: %r", line[:120])
                        continue
                    try:
                        self.handle(obj)
                    except Exception:                      # noqa: BLE001
                        log.exception("メッセージ処理で例外: %r", line[:200])

            now = time.time()
            if now - self.last_list_pub >= LIST_INTERVAL_SEC:
                self.expire()
                self.publish_list()
                self.last_list_pub = now
            if now - self.last_status_pub >= STATUS_INTERVAL_SEC:
                self.publish_status()
                self.last_status_pub = now

    def shutdown(self):
        self._running = False


def read_system_stats():
    stats = {}
    try:
        with open("/proc/loadavg", "r", encoding="utf-8") as f:
            parts = f.read().split()
        stats["cpu_load"] = [float(parts[0]), float(parts[1]), float(parts[2])]
    except (OSError, ValueError, IndexError):
        pass
    try:
        mem = {}
        with open("/proc/meminfo", "r", encoding="utf-8") as f:
            for line in f:
                k, _, v = line.partition(":")
                mem[k] = float(v.strip().split()[0]) / 1024.0
        stats["ram_free_mb"] = round(mem.get("MemAvailable", 0.0), 1)
        stats["ram_total_mb"] = round(mem.get("MemTotal", 0.0), 1)
    except (OSError, ValueError, IndexError):
        pass
    try:
        with open("/sys/class/thermal/thermal_zone0/temp", "r", encoding="utf-8") as f:
            stats["cpu_temp_c"] = round(int(f.read().strip()) / 1000.0, 1)
    except (OSError, ValueError):
        pass
    return stats


def main():
    ap = argparse.ArgumentParser(description="SkyLens UDP JSON → MQTT ブリッジ")
    ap.add_argument("--bind", default="127.0.0.1", help="UDP 待受アドレス")
    ap.add_argument("--udp-port", type=int, default=None,
                    help="UDP 待受ポート (既定: config.yml の output.udp.port)")
    ap.add_argument("--receiver-id", default=None,
                    help="MQTT トピックの receiver_id (既定: /boot/OGN-receiver.conf)")
    ap.add_argument("--skylens-config", default=SKYLENS_CONFIG)
    ap.add_argument("--latitude", type=float, default=None)
    ap.add_argument("--longitude", type=float, default=None)
    ap.add_argument("--altitude", type=float, default=None,
                    help="局の楕円体高 [m]")
    ap.add_argument("--geoid-separation", type=float, default=37.0,
                    help="ジオイド高 [m]。楕円体高から引いて標高にする (関東=37)")
    ap.add_argument("--max-jump-speed", type=float, default=200.0,
                    help="位置飛びとみなす見かけ速度 [m/s]")
    ap.add_argument("--verbose", action="store_true")
    args = ap.parse_args()

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
    )

    bridge = SkyLensBridge(args)

    def shutdown(signum, frame):
        log.info("シグナル %s を受信、終了します", signum)
        bridge.shutdown()

    signal.signal(signal.SIGTERM, shutdown)
    signal.signal(signal.SIGINT, shutdown)

    bridge.connect()
    for _ in range(50):
        if bridge._connected:
            break
        time.sleep(0.1)
    if not bridge._connected:
        log.error("MQTT ブローカに接続できません")
        return 1

    try:
        bridge.run()
    finally:
        bridge.stop()
    return 0


if __name__ == "__main__":
    sys.exit(main())
