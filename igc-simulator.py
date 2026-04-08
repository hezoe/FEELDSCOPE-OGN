#!/usr/bin/env python3
"""IGC Flight Log Simulator for OGN MQTT

Reads IGC files and replays them as MQTT messages compatible with ogn-mqtt.py.
Supports multiple simultaneous aircraft, speed control, and loop playback.

Usage:
    python3 igc-simulator.py testdata/*.igc
    python3 igc-simulator.py --speed 10 --loop testdata/*.igc
    python3 igc-simulator.py --speed 50 --receiver-id SimJP testdata/flight1.igc testdata/flight2.igc
"""

import argparse
import json
import math
import os
import re
import signal
import sys
import time
import logging
from datetime import datetime, timezone, timedelta

import paho.mqtt.client as mqtt

# ---------------------------------------------------------------------------
# Configuration defaults
# ---------------------------------------------------------------------------
DEFAULT_BROKER = "localhost"
DEFAULT_PORT = 1883
DEFAULT_RECEIVER_ID = "TestJP"
DEFAULT_SPEED = 1.0
MQTT_BASE_TOPIC = "ogn"

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%S",
)
log = logging.getLogger("igc-simulator")


# ---------------------------------------------------------------------------
# IGC Parser
# ---------------------------------------------------------------------------

class IGCFlight:
    """Parsed IGC flight data."""

    def __init__(self, filepath):
        self.filepath = filepath
        self.pilot = ""
        self.glider_type = ""
        self.glider_id = ""          # JA registration (e.g. JA01EZ)
        self.competition_id = ""     # Contest number (e.g. E1)
        self.date = None             # Flight date from HFDTE
        self.device_id = ""          # Generated MQTT device ID
        self.fixes = []              # List of (utc_seconds, lat, lon, gps_alt, press_alt)

        self._parse()

    def _parse(self):
        with open(self.filepath, "r", errors="replace") as f:
            for line in f:
                line = line.rstrip()
                if line.startswith("HFPLT") or line.startswith("HPPLT"):
                    self.pilot = self._extract_header_value(line)
                elif line.startswith("HFGTY") or line.startswith("HPGTY"):
                    self.glider_type = self._extract_header_value(line)
                elif line.startswith("HFGID") or line.startswith("HPGID"):
                    self.glider_id = self._extract_header_value(line)
                elif line.startswith("HFCID") or line.startswith("HPCID"):
                    self.competition_id = self._extract_header_value(line)
                elif line.startswith("HFDTE") or line.startswith("HPDTE"):
                    self._parse_date(line)
                elif line.startswith("B") and len(line) >= 35:
                    fix = self._parse_b_record(line)
                    if fix:
                        self.fixes.append(fix)

        # Generate device ID from glider_id or filename
        if self.glider_id:
            self.device_id = "SIM" + re.sub(r"[^A-Za-z0-9]", "", self.glider_id)
        else:
            base = os.path.splitext(os.path.basename(self.filepath))[0]
            self.device_id = "SIM" + re.sub(r"[^A-Za-z0-9]", "", base)[:10]

        log.info(
            "Loaded %s: %s (%s) %s, %d fixes, %s - %s UTC",
            os.path.basename(self.filepath),
            self.glider_id or "unknown",
            self.competition_id or "?",
            self.pilot or "unknown",
            len(self.fixes),
            self._fmt_sod(self.fixes[0][0]) if self.fixes else "?",
            self._fmt_sod(self.fixes[-1][0]) if self.fixes else "?",
        )

    @staticmethod
    def _extract_header_value(line):
        """Extract value from H record like 'HFPLTPILOTINCHARGE:Hiroshi Ezoe'."""
        idx = line.find(":")
        if idx >= 0:
            return line[idx + 1:].strip()
        return ""

    def _parse_date(self, line):
        """Parse HFDTE record: HFDTEDATE:DDMMYY,NN or HFDTE:DDMMYY or HFDTEDDMMYY."""
        m = re.search(r"(\d{6})", line)
        if m:
            d = m.group(1)
            dd, mm, yy = int(d[0:2]), int(d[2:4]), int(d[4:6])
            year = 2000 + yy if yy < 80 else 1900 + yy
            try:
                self.date = datetime(year, mm, dd, tzinfo=timezone.utc)
            except ValueError:
                pass

    @staticmethod
    def _parse_b_record(line):
        """Parse B record into (utc_seconds, lat, lon, gps_alt, press_alt).

        Format: BHHMMSSDDMMmmmNDDDMMmmmEAPPPPPGGGGG...
                B0231483600574N13949069EA-00620002800612
        """
        try:
            hh = int(line[1:3])
            mm = int(line[3:5])
            ss = int(line[5:7])
            utc_sod = hh * 3600 + mm * 60 + ss

            # Latitude: DDMMmmmN/S
            lat_deg = int(line[7:9])
            lat_min_int = int(line[9:11])
            lat_min_dec = int(line[11:14])
            lat = lat_deg + (lat_min_int + lat_min_dec / 1000.0) / 60.0
            if line[14] == "S":
                lat = -lat

            # Longitude: DDDMMmmmE/W
            lon_deg = int(line[15:18])
            lon_min_int = int(line[18:20])
            lon_min_dec = int(line[20:23])
            lon = lon_deg + (lon_min_int + lon_min_dec / 1000.0) / 60.0
            if line[23] == "W":
                lon = -lon

            validity = line[24]  # A=3D fix, V=2D

            press_alt = int(line[25:30])
            gps_alt = int(line[30:35])

            return (utc_sod, lat, lon, gps_alt, press_alt)
        except (ValueError, IndexError):
            return None

    @staticmethod
    def _fmt_sod(sod):
        return f"{sod // 3600:02d}:{(sod % 3600) // 60:02d}:{sod % 60:02d}"


# ---------------------------------------------------------------------------
# Timeline: merge and replay multiple flights
# ---------------------------------------------------------------------------

class TimelineEvent:
    """A single position event for replay."""
    __slots__ = (
        "utc_sod", "device_id", "pilot", "glider_type", "glider_id",
        "competition_id", "lat", "lon", "alt_m", "press_alt_m",
        "prev_lat", "prev_lon", "prev_alt", "prev_sod",
    )

    def __init__(self, utc_sod, flight, fix_idx):
        fix = flight.fixes[fix_idx]
        self.utc_sod = fix[0]
        self.device_id = flight.device_id
        self.pilot = flight.pilot
        self.glider_type = flight.glider_type
        self.glider_id = flight.glider_id
        self.competition_id = flight.competition_id
        self.lat = fix[1]
        self.lon = fix[2]
        self.alt_m = fix[3]
        self.press_alt_m = fix[4]

        # Previous fix for speed/heading/climb calculation
        if fix_idx > 0:
            prev = flight.fixes[fix_idx - 1]
            self.prev_lat = prev[1]
            self.prev_lon = prev[2]
            self.prev_alt = prev[3]
            self.prev_sod = prev[0]
        else:
            self.prev_lat = fix[1]
            self.prev_lon = fix[2]
            self.prev_alt = fix[3]
            self.prev_sod = fix[0]


def build_timeline(flights):
    """Merge all flights into a single time-ordered event list."""
    events = []
    for flight in flights:
        for i in range(len(flight.fixes)):
            events.append(TimelineEvent(flight.fixes[i][0], flight, i))
    events.sort(key=lambda e: e.utc_sod)
    return events


# ---------------------------------------------------------------------------
# Geodesic helpers
# ---------------------------------------------------------------------------

def haversine_m(lat1, lon1, lat2, lon2):
    """Distance in meters between two points."""
    R = 6371000
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = (math.sin(dlat / 2) ** 2 +
         math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) *
         math.sin(dlon / 2) ** 2)
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def bearing_deg(lat1, lon1, lat2, lon2):
    """Bearing from point 1 to point 2 in degrees."""
    lat1, lon1 = math.radians(lat1), math.radians(lon1)
    lat2, lon2 = math.radians(lat2), math.radians(lon2)
    dlon = lon2 - lon1
    x = math.sin(dlon) * math.cos(lat2)
    y = (math.cos(lat1) * math.sin(lat2) -
         math.sin(lat1) * math.cos(lat2) * math.cos(dlon))
    return (math.degrees(math.atan2(x, y)) + 360) % 360


# ---------------------------------------------------------------------------
# MQTT Publisher (ogn-mqtt.py compatible)
# ---------------------------------------------------------------------------

class SimulatorPublisher:
    def __init__(self, broker, port, receiver_id):
        self.broker = broker
        self.port = port
        self.receiver_id = receiver_id
        self.base_topic = f"{MQTT_BASE_TOPIC}/{receiver_id}"
        self.client = mqtt.Client(
            client_id=f"igc-sim-{receiver_id}",
            callback_api_version=mqtt.CallbackAPIVersion.VERSION2,
        )
        self.client.will_set(
            f"{self.base_topic}/status",
            payload=json.dumps({"online": False}),
            qos=1,
            retain=True,
        )
        self._connected = False
        self._aircraft_state = {}  # device_id -> latest event info

    def connect(self):
        self.client.on_connect = self._on_connect
        self.client.on_disconnect = self._on_disconnect
        self.client.connect(self.broker, self.port, keepalive=60)
        self.client.loop_start()
        for _ in range(20):
            if self._connected:
                break
            time.sleep(0.25)
        if not self._connected:
            log.error("Could not connect to MQTT broker at %s:%d", self.broker, self.port)
            sys.exit(1)
        log.info("Connected to MQTT broker %s:%d", self.broker, self.port)

    def _on_connect(self, client, userdata, flags, rc, properties=None):
        if rc == 0:
            self._connected = True

    def _on_disconnect(self, client, userdata, flags, rc, properties=None):
        self._connected = False
        log.warning("MQTT disconnected: rc=%s", rc)

    def _publish(self, topic, payload, retain=False, qos=0):
        msg = json.dumps(payload, ensure_ascii=False)
        self.client.publish(topic, msg, qos=qos, retain=retain)

    def publish_position(self, event):
        """Publish a position report compatible with ogn-mqtt.py format."""
        dt = event.utc_sod - event.prev_sod
        if dt <= 0:
            dt = 1

        dist = haversine_m(event.prev_lat, event.prev_lon, event.lat, event.lon)
        ground_speed = dist / dt
        climb_rate = (event.alt_m - event.prev_alt) / dt
        hdg = bearing_deg(event.prev_lat, event.prev_lon, event.lat, event.lon)

        # Calculate turn rate from previous heading
        prev_state = self._aircraft_state.get(event.device_id)
        turn_rate = 0.0
        if prev_state and dt > 0:
            prev_hdg = prev_state.get("heading", hdg)
            dh = hdg - prev_hdg
            if dh > 180:
                dh -= 360
            elif dh < -180:
                dh += 360
            turn_rate = dh / dt

        now_utc = datetime.now(timezone.utc)
        sod = event.utc_sod % 86400
        h, mi, s = sod // 3600, (sod % 3600) // 60, sod % 60
        ts = now_utc.replace(hour=h, minute=mi, second=s, microsecond=0)

        position = {
            "timestamp_utc": ts.isoformat(),
            "timestamp_sod": event.utc_sod,
            "latitude": round(event.lat, 6),
            "longitude": round(event.lon, 6),
            "altitude_m": event.alt_m,
            "climb_rate_ms": round(climb_rate, 1),
            "ground_speed_ms": round(ground_speed, 1),
            "heading_deg": round(hdg, 1),
            "turn_rate_degs": round(turn_rate, 1),
            "stealth": False,
            "relay": False,
            "no_tracking": False,
            "flags_raw": "__0",
            "h_accuracy_m": 3,
            "v_accuracy_m": 5,
            "frame_info": "sim__",
            "freq_offset_khz": 0.0,
            "snr_db": 30.0,
            "signal_db": 45.0,
            "channel_errors": 0,
            "bit_errors": 0,
            "distance_km": 0.0,
            "bearing_deg": 0.0,
            "elevation_deg": 0.0,
            "is_latest": True,
            # Simulator-specific fields
            "simulated": True,
            "pilot": event.pilot,
            "glider_type": event.glider_type,
            "glider_id": event.glider_id,
            "competition_id": event.competition_id,
        }

        topic = f"{self.base_topic}/aircraft/{event.device_id}/position"
        self._publish(topic, position, retain=False, qos=0)

        # Update aircraft state
        self._aircraft_state[event.device_id] = {
            "heading": hdg,
            "last_position": position,
            "packets": self._aircraft_state.get(event.device_id, {}).get("packets", 0) + 1,
        }

    def publish_aircraft_status(self, event):
        """Publish aircraft summary compatible with ogn-mqtt.py format."""
        state = self._aircraft_state.get(event.device_id, {})
        summary = {
            "device_id": event.device_id,
            "packets_received": state.get("packets", 1),
            "last_seen_sec": 0,
            "protocol": 1,
            "address_type": 2,
            "address": event.device_id,
            "flags": "S*",
            "avg_speed_ms": 0.0,
            "avg_snr_db": 30.0,
            "avg_bit_errors": 0.0,
            "freq_offset_khz": 0.0,
            "freq_correction_khz": 0.0,
            "latest_position": state.get("last_position"),
            # Simulator-specific
            "simulated": True,
            "pilot": event.pilot,
            "glider_type": event.glider_type,
            "glider_id": event.glider_id,
            "competition_id": event.competition_id,
        }
        topic = f"{self.base_topic}/aircraft/{event.device_id}/status"
        self._publish(topic, summary, retain=True, qos=1)

    def publish_aircraft_list(self):
        """Publish aggregated aircraft list."""
        aircraft_list = []
        for dev_id, state in self._aircraft_state.items():
            entry = {
                "device_id": dev_id,
                "packets_received": state.get("packets", 0),
                "latest_position": state.get("last_position"),
            }
            aircraft_list.append(entry)

        payload = {
            "timestamp_utc": datetime.now(timezone.utc).isoformat(),
            "count": len(aircraft_list),
            "aircraft": aircraft_list,
            "simulated": True,
        }
        topic = f"{self.base_topic}/aircraft"
        self._publish(topic, payload, retain=True, qos=1)

    def publish_simulator_status(self, progress_pct, speed, total_aircraft, is_loop):
        """Publish simulator status (compatible with receiver status topic)."""
        status = {
            "receiver_id": self.receiver_id,
            "timestamp_utc": datetime.now(timezone.utc).isoformat(),
            "online": True,
            "simulated": True,
            "simulator": {
                "progress_pct": round(progress_pct, 1),
                "speed": speed,
                "total_aircraft": total_aircraft,
                "loop": is_loop,
            },
        }
        topic = f"{self.base_topic}/status"
        self._publish(topic, status, retain=True, qos=1)

    def publish_offline(self):
        topic = f"{self.base_topic}/status"
        self._publish(topic, {"online": False, "simulated": True}, retain=True, qos=1)

    def stop(self):
        self.publish_offline()
        self.client.loop_stop()
        self.client.disconnect()


# ---------------------------------------------------------------------------
# Simulator engine
# ---------------------------------------------------------------------------

class IGCSimulator:
    def __init__(self, flights, publisher, speed, loop, interval):
        self.flights = flights
        self.publisher = publisher
        self.speed = speed
        self.loop = loop
        self.interval = interval  # min seconds between MQTT publishes per aircraft
        self._running = True
        self._last_publish = {}  # device_id -> last publish wall time
        self._speed_changed = False  # flag set when speed is updated via MQTT
        self._setup_speed_listener()

    def _setup_speed_listener(self):
        """Subscribe to MQTT command topic for dynamic speed changes."""
        cmd_topic = f"{self.publisher.base_topic}/command"
        def on_command(client, userdata, msg):
            try:
                data = json.loads(msg.payload.decode())
                if "speed" in data:
                    new_speed = max(1, min(20, float(data["speed"])))
                    if new_speed != self.speed:
                        log.info("Speed changed: %.1fx -> %.1fx", self.speed, new_speed)
                        self.speed = new_speed
                        self._speed_changed = True
            except Exception as e:
                log.warning("Bad command message: %s", e)
        self.publisher.client.subscribe(cmd_topic, qos=1)
        self.publisher.client.message_callback_add(cmd_topic, on_command)
        log.info("Listening for speed commands on %s", cmd_topic)

    def run(self):
        signal.signal(signal.SIGTERM, self._shutdown)
        signal.signal(signal.SIGINT, self._shutdown)

        loop_count = 0
        while self._running:
            loop_count += 1
            log.info(
                "=== %s playback (loop %d, speed %.1fx, %d aircraft) ===",
                "Starting" if loop_count == 1 else "Restarting",
                loop_count, self.speed, len(self.flights),
            )

            timeline = build_timeline(self.flights)
            if not timeline:
                log.error("No fix data to replay")
                return

            self._replay(timeline)

            if not self.loop or not self._running:
                break

            self.publisher._aircraft_state.clear()
            self._last_publish.clear()
            log.info("Loop complete, restarting...")
            time.sleep(1)

        log.info("Simulator finished")

    def _replay(self, timeline):
        total = len(timeline)
        start_sod = timeline[0].utc_sod
        end_sod = timeline[-1].utc_sod
        duration = max(end_sod - start_sod, 1)
        wall_start = time.monotonic()
        status_interval = 5.0  # publish status every 5 wall seconds
        last_status = 0.0

        # For dynamic speed change: track the sim-time anchor
        anchor_sod = start_sod      # simulation second-of-day at anchor point
        anchor_wall = wall_start    # wall clock at anchor point

        prev_sim_sod = start_sod
        publish_count = 0

        for i, event in enumerate(timeline):
            if not self._running:
                break

            # If speed was changed, re-anchor timing from current position
            if self._speed_changed:
                self._speed_changed = False
                anchor_sod = event.utc_sod
                anchor_wall = time.monotonic()

            # Wait for the right time (relative to anchor)
            sim_elapsed = event.utc_sod - anchor_sod
            wall_target = anchor_wall + sim_elapsed / self.speed
            now = time.monotonic()
            wait = wall_target - now
            if wait > 0:
                # Sleep in small chunks so speed changes take effect quickly
                while wait > 0 and self._running and not self._speed_changed:
                    time.sleep(min(wait, 0.2))
                    now = time.monotonic()
                    wait = wall_target - now
                # If speed changed during wait, re-anchor and skip remaining wait
                if self._speed_changed:
                    self._speed_changed = False
                    anchor_sod = event.utc_sod
                    anchor_wall = time.monotonic()

            # Throttle per-aircraft publish rate
            dev_last = self._last_publish.get(event.device_id, 0)
            now = time.monotonic()
            if now - dev_last < self.interval / self.speed:
                continue

            self.publisher.publish_position(event)
            self.publisher.publish_aircraft_status(event)
            self._last_publish[event.device_id] = now
            publish_count += 1

            # Periodic aggregated list + status
            if now - last_status >= status_interval:
                progress = (event.utc_sod - start_sod) / duration * 100
                self.publisher.publish_aircraft_list()
                self.publisher.publish_simulator_status(
                    progress, self.speed, len(self.flights), self.loop,
                )
                last_status = now

                # Log progress
                sim_time = IGCFlight._fmt_sod(event.utc_sod)
                log.info(
                    "Progress: %.0f%% | sim time %s | %d msgs published",
                    progress, sim_time, publish_count,
                )

        # Final publish
        self.publisher.publish_aircraft_list()
        self.publisher.publish_simulator_status(
            100.0, self.speed, len(self.flights), self.loop,
        )

    def _shutdown(self, signum, frame):
        log.info("Shutdown requested")
        self._running = False


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(
        description="IGC Flight Log Simulator for OGN MQTT",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  %(prog)s testdata/*.igc                         # Real-time replay
  %(prog)s --speed 10 testdata/*.igc              # 10x speed
  %(prog)s --speed 50 --loop testdata/*.igc       # 50x speed, loop
  %(prog)s --receiver-id SimJP testdata/a.igc     # Custom receiver ID
  %(prog)s --interval 2 testdata/*.igc            # Publish every 2s per aircraft
        """,
    )
    parser.add_argument("files", nargs="*", help="IGC file(s) to replay")
    parser.add_argument("--dir", default=None,
                        help="Directory to scan for *.igc files (alternative to listing files)")
    parser.add_argument("--speed", type=float, default=DEFAULT_SPEED,
                        help=f"Playback speed multiplier (default: {DEFAULT_SPEED})")
    parser.add_argument("--loop", action="store_true",
                        help="Loop playback continuously")
    parser.add_argument("--broker", default=DEFAULT_BROKER,
                        help=f"MQTT broker host (default: {DEFAULT_BROKER})")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT,
                        help=f"MQTT broker port (default: {DEFAULT_PORT})")
    parser.add_argument("--receiver-id", default=DEFAULT_RECEIVER_ID,
                        help=f"Receiver ID for MQTT topics (default: {DEFAULT_RECEIVER_ID})")
    parser.add_argument("--interval", type=float, default=1.0,
                        help="Min seconds between publishes per aircraft in sim time (default: 1.0)")

    args = parser.parse_args()

    # Collect file list
    file_list = list(args.files) if args.files else []
    if args.dir:
        import glob
        found = sorted(
            glob.glob(os.path.join(args.dir, "*.igc"))
            + glob.glob(os.path.join(args.dir, "*.IGC"))
        )
        file_list.extend(found)
        if found:
            log.info("Found %d IGC file(s) in %s", len(found), args.dir)

    if not file_list:
        parser.error("No IGC files specified. Use positional args or --dir")

    # Load IGC files
    flights = []
    for filepath in file_list:
        if not os.path.isfile(filepath):
            log.warning("File not found: %s", filepath)
            continue
        try:
            flight = IGCFlight(filepath)
            if flight.fixes:
                flights.append(flight)
            else:
                log.warning("No fixes in %s, skipping", filepath)
        except Exception as e:
            log.error("Failed to parse %s: %s", filepath, e)

    if not flights:
        log.error("No valid IGC files loaded")
        sys.exit(1)

    log.info("Loaded %d flight(s), connecting to MQTT...", len(flights))

    # Connect and run
    publisher = SimulatorPublisher(args.broker, args.port, args.receiver_id)
    publisher.connect()

    simulator = IGCSimulator(flights, publisher, args.speed, args.loop, args.interval)
    try:
        simulator.run()
    finally:
        publisher.stop()


if __name__ == "__main__":
    main()
