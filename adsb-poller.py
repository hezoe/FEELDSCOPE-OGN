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
DEFAULT_RECEIVER_ID = "TestJP"
DEFAULT_INTERVAL = 3.0
MQTT_BASE_TOPIC = "ogn"

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


def fetch_aircraft(url):
    """Fetch aircraft.json from tar1090/dump1090."""
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

    while _running:
        data = fetch_aircraft(args.url)
        if data and "aircraft" in data:
            current_ids = set()
            aircraft_list = []
            for ac in data["aircraft"]:
                result = convert_aircraft(ac)
                if result is None:
                    continue
                device_id, position = result
                current_ids.add(device_id)

                # Only publish position to map if we have coordinates
                if position["has_position"]:
                    topic = f"{base_topic}/aircraft/{device_id}/position"
                    client.publish(topic, json.dumps(position, ensure_ascii=False), qos=0)

                # All aircraft (with or without position) go into the list
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
                log.info("Published %d ADS-B aircraft", len(aircraft_list))

        # Sleep in small chunks for responsive shutdown
        wait = args.interval
        while wait > 0 and _running:
            time.sleep(min(wait, 0.5))
            wait -= 0.5

    client.loop_stop()
    client.disconnect()
    log.info("ADS-B poller stopped")


if __name__ == "__main__":
    main()
