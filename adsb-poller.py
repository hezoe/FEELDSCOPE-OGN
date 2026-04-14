#!/usr/bin/env python3
"""ADS-B Poller for OGN WebApp

Fetches aircraft data from a tar1090/dump1090 aircraft.json endpoint
and publishes to MQTT in the same format as ogn-mqtt.py.

Usage:
    python3 adsb-poller.py --url http://192.168.190.148/tar1090/data/aircraft.json
    python3 adsb-poller.py --url http://192.168.190.148/tar1090/data/aircraft.json --interval 3
"""

import argparse
import json
import logging
import signal
import sys
import time
from datetime import datetime, timezone

import paho.mqtt.client as mqtt

try:
    import requests
except ImportError:
    import urllib.request
    import urllib.error
    requests = None

DEFAULT_BROKER = "localhost"
DEFAULT_PORT = 1883
DEFAULT_INTERVAL = 3.0
MQTT_BASE_TOPIC = "ogn"


def _detect_receiver_id():
    """Auto-detect receiver ID from OGN configuration files."""
    try:
        with open("/boot/OGN-receiver.conf", "r") as f:
            for line in f:
                if line.strip().startswith("ReceiverName="):
                    name = line.split("=", 1)[1].split("#")[0].strip().strip('"').strip("'")
                    if name:
                        return name
    except FileNotFoundError:
        pass
    try:
        import re as _re
        with open("/home/pi/rtlsdr-ogn.conf", "r") as f:
            for line in f:
                m = _re.search(r'Call\s*=\s*"([^"]+)"', line)
                if m:
                    return m.group(1)
    except FileNotFoundError:
        pass
    return "OGNReceiver"


DEFAULT_RECEIVER_ID = _detect_receiver_id()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%S",
)
log = logging.getLogger("adsb-poller")

_running = True


def signal_handler(sig, frame):
    global _running
    log.info("Shutdown requested")
    _running = False


_last_fetch_error = None


def fetch_aircraft(url):
    """Fetch aircraft.json from tar1090/dump1090. Sets _last_fetch_error on failure."""
    global _last_fetch_error
    _last_fetch_error = None
    try:
        if requests:
            resp = requests.get(url, timeout=5)
            resp.raise_for_status()
            return resp.json()
        else:
            req = urllib.request.Request(url)
            with urllib.request.urlopen(req, timeout=5) as resp:
                return json.loads(resp.read().decode())
    except Exception as e:
        _last_fetch_error = f"{type(e).__name__}: {e}"
        log.warning("Failed to fetch %s: %s", url, e)
        return None


def classify_aircraft(ac):
    """Determine if aircraft is ADS-B or Mode-S/C based on tar1090 fields.

    tar1090 type field meanings:
      'adsb_icao', 'adsb_icao_nt' = ADS-B
      'mlat' = MLAT-derived position
      'tisb_icao', 'tisb_trackfile' = TIS-B
      'mode_s', 'adsc' = Mode-S
      Other/missing = Mode-C or unknown
    """
    ac_type = (ac.get("type") or "").lower()
    if "adsb" in ac_type or "tisb" in ac_type:
        return "adsb"
    if "mlat" in ac_type or "mode_s" in ac_type or "adsc" in ac_type:
        return "modes"
    return "modes"  # Default to Mode-S/C for anything else


def convert_aircraft(ac):
    """Convert tar1090 aircraft entry to ogn-mqtt position format.

    Returns (device_id, position_dict) or None if no hex id.
    Includes aircraft without position (Mode-S/C) with has_position=false.
    """
    hex_id = ac.get("hex", "").strip()
    if not hex_id:
        return None

    lat = ac.get("lat")
    lon = ac.get("lon")
    has_position = lat is not None and lon is not None

    # Altitude: prefer alt_baro, fallback to alt_geom. Value in feet, convert to meters.
    alt_ft = ac.get("alt_baro") or ac.get("alt_geom")
    if alt_ft is None or alt_ft == "ground":
        alt_m = 0
    else:
        alt_m = int(float(alt_ft) * 0.3048)

    # Ground speed: knots to m/s
    gs_knots = ac.get("gs", 0) or 0
    gs_ms = round(gs_knots * 0.514444, 1)

    # Vertical rate: ft/min to m/s
    vr_fpm = ac.get("baro_rate") or ac.get("geom_rate") or 0
    climb_ms = round(vr_fpm * 0.00508, 1)

    track = ac.get("track", 0) or 0
    flight = (ac.get("flight") or "").strip()
    adsb_mode = classify_aircraft(ac)

    now_utc = datetime.now(timezone.utc)
    device_id = "ADSB" + hex_id.upper().replace(" ", "")

    position = {
        "timestamp_utc": now_utc.isoformat(),
        "timestamp_sod": now_utc.hour * 3600 + now_utc.minute * 60 + now_utc.second,
        "latitude": round(lat, 6) if has_position else 0,
        "longitude": round(lon, 6) if has_position else 0,
        "altitude_m": alt_m,
        "climb_rate_ms": climb_ms,
        "ground_speed_ms": gs_ms,
        "heading_deg": round(track, 1),
        "turn_rate_degs": 0.0,
        "stealth": False,
        "relay": False,
        "no_tracking": False,
        "flags_raw": "__0",
        "h_accuracy_m": 10,
        "v_accuracy_m": 15,
        "frame_info": "adsb_",
        "freq_offset_khz": 0.0,
        "snr_db": 0.0,
        "signal_db": float(ac.get("rssi", 0) or 0),
        "channel_errors": 0,
        "bit_errors": 0,
        "distance_km": 0.0,
        "bearing_deg": 0.0,
        "elevation_deg": 0.0,
        "is_latest": True,
        "adsb": True,
        "adsb_mode": adsb_mode,
        "has_position": has_position,
        "flight": flight,
        "hex": hex_id.upper(),
        "squawk": ac.get("squawk", ""),
        "category": ac.get("category", ""),
    }

    return device_id, position


def main():
    parser = argparse.ArgumentParser(description="ADS-B Poller for OGN WebApp")
    parser.add_argument("--url", required=True, help="tar1090/dump1090 aircraft.json URL")
    parser.add_argument("--interval", type=float, default=DEFAULT_INTERVAL,
                        help=f"Polling interval in seconds (default: {DEFAULT_INTERVAL})")
    parser.add_argument("--broker", default=DEFAULT_BROKER, help="MQTT broker host")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT, help="MQTT broker port")
    parser.add_argument("--receiver-id", default=DEFAULT_RECEIVER_ID, help="Receiver ID")
    args = parser.parse_args()

    signal.signal(signal.SIGTERM, signal_handler)
    signal.signal(signal.SIGINT, signal_handler)

    base_topic = f"{MQTT_BASE_TOPIC}/{args.receiver_id}"

    client = mqtt.Client(
        client_id=f"adsb-poller-{args.receiver_id}",
        callback_api_version=mqtt.CallbackAPIVersion.VERSION2,
    )

    connected = False

    def on_connect(c, userdata, flags, rc, properties=None):
        nonlocal connected
        if rc == 0:
            connected = True
            log.info("Connected to MQTT broker %s:%d", args.broker, args.port)

    def on_disconnect(c, userdata, flags, rc, properties=None):
        nonlocal connected
        connected = False
        log.warning("MQTT disconnected: rc=%s", rc)

    client.on_connect = on_connect
    client.on_disconnect = on_disconnect
    client.connect(args.broker, args.port, keepalive=60)
    client.loop_start()

    for _ in range(20):
        if connected:
            break
        time.sleep(0.25)

    if not connected:
        log.error("Could not connect to MQTT broker")
        sys.exit(1)

    log.info("Polling %s every %.1fs", args.url, args.interval)

    prev_ids = set()
    started_at_utc = datetime.now(timezone.utc).isoformat()
    poll_count = 0
    success_count = 0
    consecutive_failures = 0
    last_error = None

    def publish_status(last_fetch_ok, with_pos, without_pos, latency_ms):
        status = {
            "started_at_utc": started_at_utc,
            "url": args.url,
            "interval_sec": args.interval,
            "last_attempt_utc": datetime.now(timezone.utc).isoformat(),
            "last_fetch_ok": last_fetch_ok,
            "last_error": last_error,
            "last_latency_ms": latency_ms,
            "poll_count": poll_count,
            "success_count": success_count,
            "consecutive_failures": consecutive_failures,
            "aircraft_with_position": with_pos,
            "aircraft_without_position": without_pos,
            "aircraft_total": with_pos + without_pos,
        }
        client.publish(f"{base_topic}/adsb_status", json.dumps(status, ensure_ascii=False), qos=1, retain=True)

    while _running:
        poll_count += 1
        t_start = time.time()
        data = fetch_aircraft(args.url)
        latency_ms = int((time.time() - t_start) * 1000)
        with_pos = 0
        without_pos = 0

        if data and "aircraft" in data:
            success_count += 1
            consecutive_failures = 0
            last_error = None
            current_ids = set()
            aircraft_list = []
            for ac in data["aircraft"]:
                result = convert_aircraft(ac)
                if result is None:
                    continue
                device_id, position = result
                current_ids.add(device_id)

                if position["has_position"]:
                    with_pos += 1
                    topic = f"{base_topic}/aircraft/{device_id}/position"
                    client.publish(topic, json.dumps(position, ensure_ascii=False), qos=0)
                else:
                    without_pos += 1

                aircraft_list.append({
                    "device_id": device_id,
                    "packets_received": 1,
                    "latest_position": position,
                    "adsb": True,
                })

            list_payload = {
                "timestamp_utc": datetime.now(timezone.utc).isoformat(),
                "count": len(aircraft_list),
                "aircraft": aircraft_list,
                "adsb": True,
            }
            client.publish(f"{base_topic}/aircraft_adsb", json.dumps(list_payload, ensure_ascii=False), qos=1, retain=True)
            prev_ids = current_ids

            if aircraft_list:
                log.info("Published %d ADS-B aircraft (pos=%d, no_pos=%d, %dms)",
                         len(aircraft_list), with_pos, without_pos, latency_ms)
            publish_status(True, with_pos, without_pos, latency_ms)
        else:
            consecutive_failures += 1
            last_error = _last_fetch_error or "fetch returned no data"
            publish_status(False, 0, 0, latency_ms)

        wait = args.interval
        while wait > 0 and _running:
            time.sleep(min(wait, 0.5))
            wait -= 0.5

    client.loop_stop()
    client.disconnect()
    log.info("ADS-B poller stopped")


if __name__ == "__main__":
    main()
