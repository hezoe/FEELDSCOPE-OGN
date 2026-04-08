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
    # The first character of the flags field indicates the protocol:
    # F=FLARM, O=OGN, I=ICAO, etc. — NOT the aircraft type.
    # Aircraft type (glider/tow plane/etc.) is encoded in the FLARM
    # packet but NOT exposed in ogn-decode's aircraft-list.txt.
    flags = m.group(7)
    return {
        "device_id": m.group(1),
        "packets_received": int(m.group(2)),
        "last_seen_sec": int(m.group(3)),
        "protocol": int(m.group(4)),
        "address_type": int(m.group(5)),
        "address": m.group(6),
        "flags": flags,
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
