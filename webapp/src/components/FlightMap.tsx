"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import L from "leaflet";
import mqtt from "mqtt";
import {
  MQTT_WS_URL,
  detectReceiverId,
  topicFor,
} from "@/lib/mqtt-config";
import { useUnits } from "@/lib/UnitContext";
import { formatAltitude, formatSpeed, formatClimbRate, formatDistance, type DisplayNameMode } from "@/lib/units";
import type {
  AircraftPosition,
  AircraftList,
  ReceiverStatus,
  AircraftDatabase,
  AircraftRecord,
} from "@/lib/types";
import { AIRCRAFT_TYPE_OPTIONS } from "@/lib/types";

// ── Colors ──
const COLOR_NORMAL = "#2e7d32";   // green
const COLOR_LOW    = "#e67e22";   // orange
const COLOR_DANGER = "#d32f2f";   // red
const COLOR_GROUND = "#888";
const COLOR_ADSB   = "#1565c0";   // blue for ADS-B
const COLOR_MODES  = "#222";      // black for Mode-S/C

function adsbColor(pos: AircraftPosition): string {
  return pos.adsb_mode === "adsb" ? COLOR_ADSB : COLOR_MODES;
}

// ── Feeldscope SVG icons ──
function svgGlider(color: string, heading: number): string {
  // High aspect ratio wings - long thin wings, slim fuselage
  return `<svg width="30" height="30" viewBox="-15 -15 30 30" style="transform:rotate(${heading}deg)"><path d="M0,-11 L.8,-3 L14,-0.5 L14,0.5 L.8,1.5 L.4,8 L2.5,9.5 L2.5,10.5 L-2.5,10.5 L-2.5,9.5 L-.4,8 L-.8,1.5 L-14,0.5 L-14,-0.5 L-.8,-3Z" fill="${color}" stroke="rgba(0,0,0,.4)" stroke-width=".5"/></svg>`;
}

function svgTow(color: string, heading: number): string {
  // Piper-style rectangular wings
  return `<svg width="30" height="30" viewBox="-15 -15 30 30" style="transform:rotate(${heading}deg)"><path d="M0,-12 L1.5,-4 L1.5,-2 L10,-2 L10,1 L1.5,1 L1,9 L4,10 L4,11.5 L-4,11.5 L-4,10 L-1,9 L-1.5,1 L-10,1 L-10,-2 L-1.5,-2 L-1.5,-4Z" fill="${color}" stroke="rgba(0,0,0,.4)" stroke-width=".5"/></svg>`;
}

function svgJet(color: string, heading: number): string {
  return `<svg width="24" height="24" viewBox="-12 -12 24 24" style="transform:rotate(${heading}deg)"><path d="M0,-10 L1.5,-4 L8,-1 L8,0.5 L1.5,1.5 L1,6 L3.5,7.5 L3.5,8.5 L-3.5,8.5 L-3.5,7.5 L-1,6 L-1.5,1.5 L-8,0.5 L-8,-1 L-1.5,-4Z" fill="${color}" stroke="rgba(255,255,255,.5)" stroke-width=".5"/></svg>`;
}

function svgPowered(color: string, heading: number): string {
  // Propeller shown as horizontal line at nose
  return `<svg width="30" height="30" viewBox="-15 -15 30 30" style="transform:rotate(${heading}deg)"><path d="M0,-11 L1.5,-4 L9,-1 L9,1 L1.5,2 L1,9 L3.5,10 L3.5,11 L-3.5,11 L-3.5,10 L-1,9 L-1.5,2 L-9,1 L-9,-1 L-1.5,-4Z" fill="${color}" stroke="rgba(0,0,0,.4)" stroke-width=".5"/><line x1="-3" y1="-12" x2="3" y2="-12" stroke="${color}" stroke-width="1.5" stroke-linecap="round"/></svg>`;
}

function svgHelicopter(color: string, heading: number): string {
  // Top: rotor line, middle: round body, bottom: V-shaped skid gear
  return `<svg width="30" height="30" viewBox="-15 -15 30 30" style="transform:rotate(${heading}deg)"><line x1="-12" y1="-10" x2="12" y2="-10" stroke="${color}" stroke-width="2" stroke-linecap="round"/><line x1="0" y1="-10" x2="0" y2="-6" stroke="${color}" stroke-width="1.2"/><circle cx="0" cy="-1" r="5.5" fill="${color}" stroke="rgba(0,0,0,.4)" stroke-width=".5"/><line x1="-4" y1="4.5" x2="-6" y2="10" stroke="${color}" stroke-width="1.5" stroke-linecap="round"/><line x1="4" y1="4.5" x2="6" y2="10" stroke="${color}" stroke-width="1.5" stroke-linecap="round"/><line x1="-7" y1="10" x2="-5" y2="10" stroke="${color}" stroke-width="1.5" stroke-linecap="round"/><line x1="5" y1="10" x2="7" y2="10" stroke="${color}" stroke-width="1.5" stroke-linecap="round"/></svg>`;
}

function svgParaglider(color: string, heading: number): string {
  // Hill-curved ram-air canopy
  return `<svg width="30" height="30" viewBox="-15 -15 30 30" style="transform:rotate(${heading}deg)"><path d="M-10,-3 Q-5,-10 0,-10 Q5,-10 10,-3 L10,-1 Q5,-6 0,-6 Q-5,-6 -10,-1Z" fill="${color}" stroke="rgba(0,0,0,.4)" stroke-width=".5"/><line x1="-7" y1="-2" x2="0" y2="6" stroke="${color}" stroke-width=".7"/><line x1="7" y1="-2" x2="0" y2="6" stroke="${color}" stroke-width=".7"/><line x1="-3" y1="-3" x2="0" y2="6" stroke="${color}" stroke-width=".5" opacity=".5"/><line x1="3" y1="-3" x2="0" y2="6" stroke="${color}" stroke-width=".5" opacity=".5"/><circle cx="0" cy="7" r="2" fill="${color}" stroke="rgba(0,0,0,.4)" stroke-width=".3"/></svg>`;
}

function svgHangglider(color: string, heading: number): string {
  // Delta wing with concave trailing edge (pinched at bottom)
  return `<svg width="30" height="30" viewBox="-15 -15 30 30" style="transform:rotate(${heading}deg)"><path d="M0,-8 L12,6 Q0,2 -12,6Z" fill="${color}" stroke="rgba(0,0,0,.4)" stroke-width=".5" fill-opacity=".8"/><circle cx="0" cy="3" r="1.5" fill="${color}" stroke="rgba(0,0,0,.4)" stroke-width=".3"/></svg>`;
}

function svgSkydiver(color: string, heading: number): string {
  return `<svg width="30" height="30" viewBox="-15 -15 30 30" style="transform:rotate(${heading}deg)"><circle cx="0" cy="-6" r="3" fill="${color}" stroke="rgba(0,0,0,.4)" stroke-width=".5"/><line x1="0" y1="-3" x2="0" y2="5" stroke="${color}" stroke-width="2" stroke-linecap="round"/><line x1="-7" y1="-1" x2="7" y2="-1" stroke="${color}" stroke-width="1.5" stroke-linecap="round"/><line x1="0" y1="5" x2="-5" y2="11" stroke="${color}" stroke-width="1.5" stroke-linecap="round"/><line x1="0" y1="5" x2="5" y2="11" stroke="${color}" stroke-width="1.5" stroke-linecap="round"/></svg>`;
}

function svgBalloon(color: string): string {
  return `<svg width="30" height="30" viewBox="-15 -15 30 30"><ellipse cx="0" cy="-3" rx="8" ry="10" fill="${color}" stroke="rgba(0,0,0,.4)" stroke-width=".5"/><line x1="-3" y1="7" x2="-2" y2="10" stroke="${color}" stroke-width=".7"/><line x1="3" y1="7" x2="2" y2="10" stroke="${color}" stroke-width=".7"/><rect x="-3" y="10" width="6" height="4" rx="1" fill="${color}" stroke="rgba(0,0,0,.4)" stroke-width=".4"/></svg>`;
}

function svgUav(color: string, heading: number): string {
  return `<svg width="30" height="30" viewBox="-15 -15 30 30" style="transform:rotate(${heading}deg)"><rect x="-3" y="-3" width="6" height="6" rx="1" fill="${color}" stroke="rgba(0,0,0,.4)" stroke-width=".5"/><line x1="-3" y1="-3" x2="-9" y2="-9" stroke="${color}" stroke-width="1.5"/><line x1="3" y1="-3" x2="9" y2="-9" stroke="${color}" stroke-width="1.5"/><line x1="-3" y1="3" x2="-9" y2="9" stroke="${color}" stroke-width="1.5"/><line x1="3" y1="3" x2="9" y2="9" stroke="${color}" stroke-width="1.5"/><circle cx="-9" cy="-9" r="3" fill="none" stroke="${color}" stroke-width=".8"/><circle cx="9" cy="-9" r="3" fill="none" stroke="${color}" stroke-width=".8"/><circle cx="-9" cy="9" r="3" fill="none" stroke="${color}" stroke-width=".8"/><circle cx="9" cy="9" r="3" fill="none" stroke="${color}" stroke-width=".8"/></svg>`;
}

function svgByType(typeCode: string | undefined, color: string, heading: number): string {
  switch (typeCode) {
    case "glider": return svgGlider(color, heading);
    case "tow": return svgTow(color, heading);
    case "powered": return svgPowered(color, heading);
    case "helicopter": return svgHelicopter(color, heading);
    case "paraglider": return svgParaglider(color, heading);
    case "hangglider": return svgHangglider(color, heading);
    case "skydiver": return svgSkydiver(color, heading);
    case "balloon": return svgBalloon(color);
    case "uav": return svgUav(color, heading);
    case "jet": return svgJet(color, heading);
    default: return svgGlider(color, heading);
  }
}

function makeAircraftIcon(heading: number, color: string, blink: boolean, gliderType?: string, isAdsb?: boolean, registration?: string, aircraftType?: string, dbType?: string) {
  let svg: string;
  if (dbType) {
    svg = svgByType(dbType, color, heading);
  } else if (isAdsb) {
    svg = svgJet(color, heading);
  } else {
    svg = isTowPlane(gliderType, registration, aircraftType)
      ? svgTow(color, heading)
      : svgGlider(color, heading);
  }
  const blinkClass = blink ? " aircraft-blink" : "";
  const size = isAdsb ? 24 : 30;
  const anchor = isAdsb ? 12 : 15;
  return L.divIcon({
    html: `<div class="aircraft-icon${blinkClass}">${svg}</div>`,
    className: "",
    iconSize: [size, size],
    iconAnchor: [anchor, anchor],
  });
}

// ── Thresholds ──
const GROUND_ALT_M = 100;
const LOW_ALT_FT = 1500;
const LOST_SIGNAL_SEC = 10;
const TAKEOFF_SPEED_MS = 30 / 3.6;   // 30 km/h
const LANDING_SPEED_MS = 10 / 3.6;   // 10 km/h
const LANDING_AGL_M = 1500 * 0.3048; // 1500 ft AGL
const RELEASE_TURN_THRESHOLD = 8;       // °/s  sharp right turn at release
const RELEASE_SPEED_DROP_MS = 10/3.6;  // 10 km/h speed drop (in m/s)
const RELEASE_MIN_AGL_M = 150;         // ~500ft minimum altitude for release detection
// Tow plane release: retrospective detection via altitude drop from peak
// During tow the altitude only rises; after release the tow plane dives away.
// A sustained 50m+ drop from peak is unmistakable — no instantaneous values needed.
const TOW_RELEASE_ALT_DROP_M = 50;     // ~160ft  sustained drop confirms release
const TOW_RELEASE_MIN_AGL_M = 300;     // ~1000ft  tow release never happens below this

// Haversine distance in meters
function haversineM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Check if glide path is insufficient
// glide ratio needed = distance / height_above_field
// danger when needed ratio > safe ratio (can't reach field)
function isDanger(pos: AircraftPosition, safeGlideRatio: number, fieldLat: number, fieldLon: number, fieldElev: number): boolean {
  if (pos.altitude_m < GROUND_ALT_M) return false; // on ground
  const heightAboveField = pos.altitude_m - fieldElev;
  if (heightAboveField <= 0) return false;
  const distM = haversineM(fieldLat, fieldLon, pos.latitude, pos.longitude);
  const neededRatio = distM / heightAboveField;
  return neededRatio > safeGlideRatio;
}

// Determine aircraft status
type AircraftAlert = "normal" | "low" | "danger";

function getAlert(pos: AircraftPosition, safeGlideRatio: number, fieldLat: number, fieldLon: number, fieldElev: number): AircraftAlert {
  if (pos.altitude_m < GROUND_ALT_M) return "normal";
  if (isDanger(pos, safeGlideRatio, fieldLat, fieldLon, fieldElev)) return "danger";
  const lowAltM = LOW_ALT_FT * 0.3048 + fieldElev;
  if (pos.altitude_m < lowAltM) return "low";
  return "normal";
}

function alertColor(alert: AircraftAlert): string {
  if (alert === "danger") return COLOR_DANGER;
  if (alert === "low") return COLOR_LOW;
  return COLOR_NORMAL;
}

// ── Flight log types ──
interface FlightLogEntry {
  registration: string;
  deviceId: string;
  takeoffTime: string;   // local time HH:MM:SS
  landingTime: string | null;
  releaseAlt: number | null;
  releaseDist: number | null; // distance from airfield in meters
}

interface FlightTrackingState {
  phase: "ground" | "airborne" | "released";
  takeoffTime: string | null;
  maxAltSinceTakeoff: number;
  releaseAlt: number | null;
  wasHigh: boolean;
  flightIdx: number; // index in flightLog, -1 if not in flight
  prevSpeedMs: number; // previous speed for speed-drop detection
  prevClimbMs: number; // previous climb rate for tow plane release detection
}

function nowClockStr(): string {
  return new Date().toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit", hour12: false });
}

function calcFlightDuration(takeoff: string, landing: string | null): string | null {
  const end = landing || nowClockStr();
  const [th, tm] = takeoff.split(":").map(Number);
  const [lh, lm] = end.split(":").map(Number);
  if (isNaN(th) || isNaN(tm) || isNaN(lh) || isNaN(lm)) return null;
  let diffMin = (lh * 60 + lm) - (th * 60 + tm);
  if (diffMin < 0) diffMin += 24 * 60; // across midnight
  const h = Math.floor(diffMin / 60);
  const m = diffMin % 60;
  return `${String(h).padStart(2, "0")}+${String(m).padStart(2, "0")}`;
}

function isTowPlane(gliderType?: string, registration?: string, aircraftType?: string, dbType?: string): boolean {
  // Aircraft DB type takes highest priority
  if (dbType === "tow") return true;
  if (dbType && dbType !== "tow") return false;
  // OGN aircraft_type from FLARM beacon
  if (aircraftType === "Tow Plane") return true;
  // Glider type name (IGC/simulator)
  const t = (gliderType || "").toLowerCase();
  if (t.includes("hk-36") || t.includes("husky") || t.includes("pawnee") || t.includes("piper") || t.includes("tow")) return true;
  // IGC replay: no glider_type available — use registration prefix
  const reg = (registration || "").toUpperCase();
  return reg.startsWith("JA4");
}

interface TrailPoint {
  latlng: L.LatLng;
  timeMs: number;
}

interface TrackedAircraft {
  position: AircraftPosition;
  marker: L.Marker;
  trail: L.Polyline;
  trailPoints: TrailPoint[];
  label: string;
  lastUpdateMs: number;
  adsb?: boolean;
}

const TRAIL_DURATION_MS = 60_000; // 1 minute trail

function resolveLabel(pos: AircraftPosition, deviceId: string, mode: DisplayNameMode): string {
  if (mode === "pilot" && pos.pilot) return pos.pilot;
  if (mode === "registration" && pos.glider_id) return pos.glider_id;
  if (mode === "competition_id" && pos.competition_id) return pos.competition_id;
  return pos.competition_id || pos.glider_id || deviceId;
}

/** Look up aircraft DB record by deviceId, falling back to registration match */
function lookupDbRecord(db: AircraftDatabase, deviceId: string, gliderId?: string): AircraftRecord | undefined {
  const rec = db[deviceId];
  if (rec && rec.registration) return rec;
  if (gliderId) {
    const regUpper = gliderId.toUpperCase();
    for (const r of Object.values(db)) {
      if (r.registration && r.registration.toUpperCase() === regUpper) return r;
    }
  }
  return rec; // return the (possibly empty) record if no registration match
}

export default function FlightMap() {
  const mapRef = useRef<L.Map | null>(null);
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const aircraftRef = useRef<Map<string, TrackedAircraft>>(new Map());
  const clientRef = useRef<mqtt.MqttClient | null>(null);
  const [connected, setConnected] = useState(false);
  const [receiverStatus, setReceiverStatus] = useState<ReceiverStatus | null>(null);
  const [aircraftCount, setAircraftCount] = useState(0);
  const [selectedAircraft, setSelectedAircraft] = useState<string | null>(null);
  const [, setUpdateTick] = useState(0);
  const [now, setNow] = useState(0);
  const { units } = useUnits();
  const [flightLog, setFlightLogRaw] = useState<FlightLogEntry[]>([]);
  const setFlightLog = useCallback((log: FlightLogEntry[]) => {
    setFlightLogRaw(log);
    // Sync to server memory
    fetch("/api/flight-log", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "set", entries: log }),
    }).catch(() => {});
  }, []);
  const flightLogRef = useRef<FlightLogEntry[]>([]);
  const trackingRef = useRef<Map<string, FlightTrackingState>>(new Map());
  const logTableRef = useRef<HTMLDivElement>(null);
  // Position-unknown ADS-B/Mode-S aircraft (sidebar only)
  const [noPositionAircraft, setNoPositionAircraft] = useState<AircraftPosition[]>([]);

  // Aircraft database
  const aircraftDbRef = useRef<AircraftDatabase>({});
  const pendingAutoRegister = useRef<Set<string>>(new Set());

  // Home view state
  const [homeView, setHomeView] = useState<{ lat: number; lng: number; zoom: number }>({ lat: 0, lng: 0, zoom: 11 });

  // Resizable panels
  const [sidebarWidth, setSidebarWidth] = useState(280);
  const [logHeight, setLogHeight] = useState(160);
  const mainRef = useRef<HTMLDivElement>(null);

  // Hydration-safe: restore client-only state in useEffect
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    // Restore flight log from server
    fetch("/api/flight-log")
      .then(res => res.json())
      .then(data => {
        const restored: FlightLogEntry[] = data.entries || [];
        if (restored.length > 0) {
          setFlightLogRaw(restored);
          flightLogRef.current = restored;
          // Rebuild tracking state
          const map = new Map<string, FlightTrackingState>();
          for (let i = 0; i < restored.length; i++) {
            const entry = restored[i];
            if (!entry.landingTime) {
              map.set(entry.deviceId, {
                phase: entry.releaseAlt != null ? "released" : "airborne",
                takeoffTime: entry.takeoffTime,
                maxAltSinceTakeoff: entry.releaseAlt ?? 0,
                releaseAlt: entry.releaseAlt,
                wasHigh: true,
                flightIdx: i,
                prevSpeedMs: 0, prevClimbMs: 0,
              });
            } else {
              map.set(entry.deviceId, {
                phase: "ground",
                takeoffTime: null,
                maxAltSinceTakeoff: 0,
                releaseAlt: null,
                wasHigh: false,
                flightIdx: -1,
                prevSpeedMs: 0, prevClimbMs: 0,
              });
            }
          }
          trackingRef.current = map;
        }
      })
      .catch(() => {});
    // Restore panel sizes
    try {
      const sw = localStorage.getItem("ogn-sidebar-width");
      if (sw) setSidebarWidth(Math.max(200, Math.min(500, parseInt(sw, 10) || 280)));
      const lh = localStorage.getItem("ogn-log-height");
      if (lh) setLogHeight(Math.max(60, Math.min(400, parseInt(lh, 10) || 160)));
    } catch { /* ignore */ }
    // Restore home view
    try {
      const hv = localStorage.getItem("ogn-home-view");
      if (hv) setHomeView(JSON.parse(hv));
    } catch { /* ignore */ }
    // Load aircraft database
    async function loadAircraftDb() {
      try {
        const res = await fetch("/api/aircraft-db");
        const data = await res.json();
        aircraftDbRef.current = data;
      } catch { /* ignore */ }
    }
    loadAircraftDb();
    const dbInterval = setInterval(loadAircraftDb, 30000);
    return () => { clearInterval(id); clearInterval(dbInterval); };
  }, []);

  const airfield = units.airfield;
  const fieldMarkerRef = useRef<L.CircleMarker | null>(null);
  const ognReceiverMarkerRef = useRef<L.Marker | null>(null);
  const tileLayersRef = useRef<L.TileLayer[]>([]);

  // Initialize map
  useEffect(() => {
    if (mapRef.current || !mapContainerRef.current) return;

    const center: L.LatLngExpression = [airfield.latitude, airfield.longitude];
    const map = L.map(mapContainerRef.current, {
      center,
      zoom: 11,
      zoomControl: false,
    });

    L.control.zoom({ position: "bottomright" }).addTo(map);

    // Create a low-z pane for the airfield marker so aircraft icons stay on top
    const airfieldPane = map.createPane("airfieldPane");
    airfieldPane.style.zIndex = "350";

    const marker = L.circleMarker(center, {
      radius: 8,
      color: "#d32f2f",
      fillColor: "#ef5350",
      fillOpacity: 0.6,
      weight: 2,
      pane: "airfieldPane",
    })
      .addTo(map)
      .bindTooltip(airfield.name, {
        permanent: true,
        direction: "top",
        offset: [0, -10],
        className: "airfield-tooltip",
        pane: "airfieldPane",
      });

    fieldMarkerRef.current = marker;
    mapRef.current = map;
    return () => { map.remove(); mapRef.current = null; fieldMarkerRef.current = null; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Swap tile layers when mapSource changes
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    // Remove existing tile layers
    for (const layer of tileLayersRef.current) {
      map.removeLayer(layer);
    }
    tileLayersRef.current = [];

    if (units.mapSource === "offline") {
      map.setMinZoom(0);
      map.setMaxZoom(17);
      if (map.getZoom() > 17) map.setZoom(17);
      const ort = L.tileLayer("/tiles/ort/{z}/{x}/{y}.jpg", {
        attribution: "<a href='https://maps.gsi.go.jp/development/ichiran.html' target='_blank'>国土地理院</a>",
        maxZoom: 17,
        pane: "tilePane",
      }).addTo(map);
      const hillshade = L.tileLayer("/tiles/hillshademap/{z}/{x}/{y}.png", {
        attribution: "",
        maxZoom: 17,
        opacity: 0.3,
        pane: "tilePane",
      }).addTo(map);
      tileLayersRef.current = [ort, hillshade];
    } else {
      map.setMinZoom(0);
      map.setMaxZoom(18);
      const osm = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "&copy; OpenStreetMap",
        maxZoom: 18,
        pane: "tilePane",
      }).addTo(map);
      tileLayersRef.current = [osm];
    }
    // Ensure markers stay above tiles
    const markerPane = map.getPane("markerPane");
    if (markerPane) markerPane.style.zIndex = "650";
  }, [units.mapSource]);

  // OGN receiver marker: poll /api/ogn for receiver location and status
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    let cancelled = false;
    let intervalId: ReturnType<typeof setInterval> | null = null;

    async function update() {
      try {
        const res = await fetch("/api/ogn");
        const data = await res.json();
        if (cancelled) return;
        const cfg = data.config;
        const status = data.status;
        if (!cfg || cfg.latitude == null || cfg.longitude == null) return;

        const online = status?.online === true;
        const color = online ? "#00b894" : "#888";
        const html = `<div style="display:flex;flex-direction:column;align-items:center;line-height:1;">
          <svg width="22" height="22" viewBox="-11 -11 22 22">
            <path d="M0,-9 L4,8 L0,5 L-4,8 Z" fill="${color}" stroke="rgba(0,0,0,.5)" stroke-width="0.7"/>
            <line x1="-3" y1="-2" x2="3" y2="-2" stroke="${color}" stroke-width="1.2"/>
            <line x1="-5" y1="-5" x2="5" y2="-5" stroke="${color}" stroke-width="1.2"/>
          </svg>
        </div>`;
        const icon = L.divIcon({ html, className: "ogn-receiver-icon", iconSize: [22, 22], iconAnchor: [11, 11] });

        const latlng = L.latLng(cfg.latitude, cfg.longitude);
        const tooltipText = `OGN受信機: ${cfg.receiverName || "—"}<br>${online ? "稼働中" : "停止"}${status?.ognGain ? `<br>Gain: ${status.ognGain}` : ""}${status?.noise ? `<br>Noise: ${status.noise}` : ""}`;

        if (!ognReceiverMarkerRef.current) {
          const m = L.marker(latlng, { icon, zIndexOffset: -100 })
            .addTo(map)
            .bindTooltip(tooltipText, { direction: "top", offset: [0, -8], className: "ogn-receiver-tooltip" });
          ognReceiverMarkerRef.current = m;
        } else {
          ognReceiverMarkerRef.current.setLatLng(latlng);
          ognReceiverMarkerRef.current.setIcon(icon);
          ognReceiverMarkerRef.current.setTooltipContent(tooltipText);
        }
      } catch { /* ignore */ }
    }

    update();
    intervalId = setInterval(update, 10000);
    return () => {
      cancelled = true;
      if (intervalId) clearInterval(intervalId);
      if (ognReceiverMarkerRef.current && mapRef.current) {
        mapRef.current.removeLayer(ognReceiverMarkerRef.current);
        ognReceiverMarkerRef.current = null;
      }
    };
  }, []);

  // Update field marker when airfield settings change
  useEffect(() => {
    const marker = fieldMarkerRef.current;
    if (!marker) return;
    const latlng = L.latLng(airfield.latitude, airfield.longitude);
    marker.setLatLng(latlng);
    marker.setTooltipContent(airfield.name);
  }, [airfield]);

  const unitsRef = useRef(units);
  useEffect(() => {
    unitsRef.current = units;
    for (const [id, ac] of aircraftRef.current) {
      if (ac.adsb) {
        ac.label = ac.position.flight || ac.position.hex || id;
        ac.marker.setIcon(makeAircraftIcon(ac.position.heading_deg, adsbColor(ac.position), false, undefined, true));
      } else {
        ac.label = resolveLabel(ac.position, id, units.displayName);
        const { airfield: af } = units;
        const alert = getAlert(ac.position, units.safeGlideRatio, af.latitude, af.longitude, af.elevation_m);
        let color = alertColor(alert);
        const blink = alert === "danger";
        // Landing approach override
        const trState = trackingRef.current.get(id);
        if (trState && trState.phase !== "ground" && alert === "normal" && ac.position.altitude_m < GROUND_ALT_M + af.elevation_m) {
          color = COLOR_LOW;
        }
        const dbRec = lookupDbRecord(aircraftDbRef.current, id, ac.position.glider_id);
        ac.marker.setIcon(makeAircraftIcon(ac.position.heading_deg, color, blink, ac.position.glider_type, false, dbRec?.registration || ac.position.glider_id || ac.position.competition_id, ac.position.aircraft_type, dbRec?.aircraft_type));
      }
      const tooltip = buildTooltip(ac.label, ac.position, unitsRef.current, ac.adsb);
      ac.marker.setTooltipContent(tooltip);
    }
  }, [units]);

  const handlePosition = useCallback(
    (deviceId: string, pos: AircraftPosition) => {
      const map = mapRef.current;
      if (!map) return;

      const isAdsb = !!pos.adsb;
      const latlng = L.latLng(pos.latitude, pos.longitude);
      const aircraft = aircraftRef.current;
      const existing = aircraft.get(deviceId);
      const u = unitsRef.current;

      // Aircraft DB lookup — first by device_id, then by registration (for history replay)
      const dbRec = lookupDbRecord(aircraftDbRef.current, deviceId, pos.glider_id);
      const dbType = dbRec?.aircraft_type;

      // Auto-register unknown non-ADS-B aircraft
      if (!isAdsb && !dbRec && !pendingAutoRegister.current.has(deviceId)) {
        pendingAutoRegister.current.add(deviceId);
        fetch("/api/aircraft-db", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ device_ids: [deviceId] }),
        }).then(() => fetch("/api/aircraft-db").then(r => r.json()).then(data => {
          aircraftDbRef.current = data;
        })).catch(() => {}).finally(() => pendingAutoRegister.current.delete(deviceId));
      }

      // Override pos fields from DB if available
      const effectiveRegistration = dbRec?.registration || pos.glider_id || pos.competition_id;
      const effectiveGliderType = dbRec?.glider_type || pos.glider_type;
      const effectivePilot = dbRec?.pilot || pos.pilot;
      const effectiveCompId = dbRec?.competition_id || pos.competition_id;

      let label: string;
      let color: string;
      let blink = false;

      if (isAdsb) {
        label = pos.flight || pos.hex || deviceId;
        color = adsbColor(pos);
      } else {
        // Use DB info for label resolution
        const labelPos = { ...pos, glider_id: effectiveRegistration, glider_type: effectiveGliderType, pilot: effectivePilot, competition_id: effectiveCompId };
        label = resolveLabel(labelPos, deviceId, u.displayName);
        const alert = getAlert(pos, u.safeGlideRatio, u.airfield.latitude, u.airfield.longitude, u.airfield.elevation_m);
        color = alertColor(alert);
        blink = alert === "danger";
        const trState = trackingRef.current.get(deviceId);
        if (trState && trState.phase !== "ground" && alert === "normal" && pos.altitude_m < GROUND_ALT_M + u.airfield.elevation_m) {
          color = COLOR_LOW;
        }
      }

      if (existing) {
        existing.position = pos;
        existing.label = label;
        existing.lastUpdateMs = Date.now();
        existing.adsb = isAdsb;
        existing.marker.setLatLng(latlng);
        existing.marker.setIcon(makeAircraftIcon(pos.heading_deg, color, blink, pos.glider_type, isAdsb, effectiveRegistration, pos.aircraft_type, dbType));
        existing.marker.setTooltipContent(buildTooltip(label, pos, unitsRef.current, isAdsb));
        const nowMs = Date.now();
        existing.trailPoints.push({ latlng, timeMs: nowMs });
        const cutoff = nowMs - TRAIL_DURATION_MS;
        while (existing.trailPoints.length > 0 && existing.trailPoints[0].timeMs < cutoff) {
          existing.trailPoints.shift();
        }
        existing.trail.setLatLngs(existing.trailPoints.map(p => p.latlng));
        existing.trail.setStyle({ color });
      } else {
        const marker = L.marker(latlng, {
          icon: makeAircraftIcon(pos.heading_deg, color, blink, pos.glider_type, isAdsb, effectiveRegistration, pos.aircraft_type, dbType),
        }).addTo(map);

        marker.bindTooltip(buildTooltip(label, pos, unitsRef.current, isAdsb), {
          permanent: true,
          direction: "right",
          offset: [12, 0],
          className: "aircraft-tooltip",
        });

        marker.on("click", () => setSelectedAircraft(deviceId));

        const trail = L.polyline([latlng], { color, weight: 2, opacity: 0.6 }).addTo(map);

        aircraft.set(deviceId, {
          position: pos, marker, trail, trailPoints: [{ latlng, timeMs: Date.now() }], label, lastUpdateMs: Date.now(), adsb: isAdsb,
        });
      }

      // ── Flight log tracking (skip ADS-B) ──
      if (isAdsb) {
        setAircraftCount(aircraft.size);
        setUpdateTick((t) => t + 1);
        return;
      }
      const fieldElev = u.airfield.elevation_m;
      const agl = pos.altitude_m - fieldElev;
      const speedMs = pos.ground_speed_ms;
      const registration = dbRec?.registration || pos.glider_id || pos.competition_id || deviceId;

      let tr = trackingRef.current.get(deviceId);
      if (!tr) {
        tr = { phase: "ground", takeoffTime: null, maxAltSinceTakeoff: 0, releaseAlt: null, wasHigh: false, flightIdx: -1, prevSpeedMs: 0, prevClimbMs: 0 };
        trackingRef.current.set(deviceId, tr);
      }

      let logChanged = false;

      if (tr.phase === "ground") {
        // Takeoff: speed > 30 km/h
        if (speedMs > TAKEOFF_SPEED_MS) {
          const timeStr = nowClockStr();
          tr.phase = "airborne";
          tr.takeoffTime = timeStr;
          tr.maxAltSinceTakeoff = agl;
          tr.releaseAlt = null;
          tr.wasHigh = agl > LANDING_AGL_M;
          console.log(`[FLIGHT] TAKEOFF ${registration} (${deviceId}) type="${pos.glider_type}" isTow=${isTowPlane(pos.glider_type, registration, pos.aircraft_type, dbType)} speed=${(speedMs*3.6).toFixed(0)}km/h agl=${agl.toFixed(0)}m`);

          tr.prevSpeedMs = speedMs;
          const entry: FlightLogEntry = {
            registration,
            deviceId,
            takeoffTime: timeStr,
            landingTime: null,
            releaseAlt: null,
            releaseDist: null,
          };
          flightLogRef.current = [...flightLogRef.current, entry];
          tr.flightIdx = flightLogRef.current.length - 1;
          logChanged = true;
        }
      } else {
        // Track max altitude AGL since takeoff
        if (agl > tr.maxAltSinceTakeoff) {
          tr.maxAltSinceTakeoff = agl;
          if (isTowPlane(pos.glider_type, registration, pos.aircraft_type, dbType)) {
            console.log(`[FLIGHT] TOW-ALT ${registration} maxAlt=${agl.toFixed(0)}m agl=${agl.toFixed(0)}m`);
          }
        }

        // Mark wasHigh once above 1500ft AGL
        if (agl > LANDING_AGL_M) {
          tr.wasHigh = true;
        }

        // Release detection
        const speedDropMs = tr.prevSpeedMs - speedMs;
        let releaseDetected = false;

        if (tr.phase === "airborne" && agl > RELEASE_MIN_AGL_M) {
          if (isTowPlane(pos.glider_type, registration, pos.aircraft_type, dbType) && agl > TOW_RELEASE_MIN_AGL_M) {
            const altDrop = tr.maxAltSinceTakeoff - agl;
            console.log(`[FLIGHT] TOW-CHECK ${registration} phase=${tr.phase} agl=${agl.toFixed(0)}m maxAlt=${tr.maxAltSinceTakeoff.toFixed(0)}m drop=${altDrop.toFixed(0)}m threshold=${TOW_RELEASE_ALT_DROP_M}m`);
            if (altDrop > TOW_RELEASE_ALT_DROP_M) {
              releaseDetected = true;
            }
          } else if (!isTowPlane(pos.glider_type, registration, pos.aircraft_type, dbType)) {
            // Glider release: sharp right turn (>8°/s) + speed dropping (>10 km/h)
            if (
              pos.turn_rate_degs > RELEASE_TURN_THRESHOLD &&
              speedDropMs > RELEASE_SPEED_DROP_MS
            ) {
              releaseDetected = true;
            }
          }
        }

        if (releaseDetected) {
          const distM = haversineM(u.airfield.latitude, u.airfield.longitude, pos.latitude, pos.longitude);
          console.log(`[FLIGHT] RELEASE DETECTED ${registration} (${deviceId}) releaseAlt=${tr.maxAltSinceTakeoff.toFixed(0)}m dist=${(distM/1000).toFixed(1)}km isTow=${isTowPlane(pos.glider_type, registration, pos.aircraft_type, dbType)}`);
          tr.phase = "released";
          tr.releaseAlt = tr.maxAltSinceTakeoff;
          if (tr.flightIdx >= 0 && tr.flightIdx < flightLogRef.current.length) {
            const updated = [...flightLogRef.current];
            updated[tr.flightIdx] = { ...updated[tr.flightIdx], releaseAlt: tr.releaseAlt, releaseDist: distM };
            flightLogRef.current = updated;
            logChanged = true;
          }
        }

        // Landing: was above 1500ft AGL at some point, now AGL < 1500ft AND speed < 10 km/h
        if (tr.wasHigh && agl < LANDING_AGL_M && speedMs < LANDING_SPEED_MS) {
          console.log(`[FLIGHT] LANDING ${registration} (${deviceId}) phase=${tr.phase} releaseAlt=${tr.releaseAlt?.toFixed(0) ?? "null"} maxAlt=${tr.maxAltSinceTakeoff.toFixed(0)}m`);
          const timeStr = nowClockStr();
          if (tr.flightIdx >= 0 && tr.flightIdx < flightLogRef.current.length) {
            const updated = [...flightLogRef.current];
            updated[tr.flightIdx] = { ...updated[tr.flightIdx], landingTime: timeStr };
            flightLogRef.current = updated;
            logChanged = true;
          }
          // Reset to ground for next flight
          tr.phase = "ground";
          tr.takeoffTime = null;
          tr.maxAltSinceTakeoff = 0;
          tr.releaseAlt = null;
          tr.wasHigh = false;

          tr.flightIdx = -1;
        }

        tr.prevSpeedMs = speedMs;
        tr.prevClimbMs = pos.climb_rate_ms;
      }

      if (logChanged) {
        setFlightLog([...flightLogRef.current]);
      }

      setAircraftCount(aircraft.size);
      setUpdateTick((t) => t + 1);
    },
    []
  );

  const handleAircraftList = useCallback((list: AircraftList) => {
    const isAdsbList = !!(list as unknown as Record<string, unknown>).adsb;
    const activeIds = new Set(list.aircraft.map((a) => a.device_id));
    const aircraft = aircraftRef.current;
    const map = mapRef.current;
    for (const [id, ac] of aircraft) {
      // Only remove aircraft of the same type (FLARM list removes FLARM, ADS-B list removes ADS-B)
      if (isAdsbList !== !!ac.adsb) continue;
      if (!activeIds.has(id)) {
        map?.removeLayer(ac.marker);
        map?.removeLayer(ac.trail);
        aircraft.delete(id);
      }
    }
    setAircraftCount(aircraft.size);

    // Extract position-unknown aircraft from ADS-B list for sidebar display
    if (isAdsbList) {
      const noPos: AircraftPosition[] = [];
      for (const ac of list.aircraft) {
        const pos = ac.latest_position;
        if (pos && pos.adsb && pos.has_position === false && pos.altitude_m > 0) {
          noPos.push(pos);
        }
      }
      setNoPositionAircraft(noPos);
    }
  }, []);

  useEffect(() => {
    const client = mqtt.connect(MQTT_WS_URL, {
      clientId: `ogn-webapp-${Math.random().toString(36).slice(2, 8)}`,
      reconnectPeriod: 3000,
    });

    client.on("connect", async () => {
      setConnected(true);
      const rid = await detectReceiverId();
      client.subscribe(topicFor(rid, "aircraft", "+", "position"));
      client.subscribe(topicFor(rid, "aircraft"));
      client.subscribe(topicFor(rid, "aircraft_adsb"));
      client.subscribe(topicFor(rid, "status"));
    });
    client.on("close", () => setConnected(false));
    client.on("message", (topic: string, payload: Buffer) => {
      try {
        const data = JSON.parse(payload.toString());
        const parts = topic.split("/");
        if (parts.length === 5 && parts[4] === "position") handlePosition(parts[3], data as AircraftPosition);
        else if (parts.length === 3 && parts[2] === "aircraft") handleAircraftList(data as AircraftList);
        else if (parts.length === 3 && parts[2] === "aircraft_adsb") handleAircraftList(data as AircraftList);
        else if (parts.length === 3 && parts[2] === "status") setReceiverStatus(data as ReceiverStatus);
      } catch { /* ignore */ }
    });

    clientRef.current = client;
    return () => { client.end(); clientRef.current = null; };
  }, [handlePosition, handleAircraftList]);

  // Auto-scroll flight log to bottom
  useEffect(() => {
    const el = logTableRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [flightLog]);

  // ── Resize handlers ──
  const startDragSidebar = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = sidebarWidth;
    const onMove = (ev: MouseEvent) => {
      const delta = startX - ev.clientX;
      const w = Math.max(200, Math.min(500, startW + delta));
      setSidebarWidth(w);
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      setSidebarWidth((w) => { localStorage.setItem("ogn-sidebar-width", String(w)); return w; });
      mapRef.current?.invalidateSize();
    };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, [sidebarWidth]);

  const startDragLog = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const startH = logHeight;
    const onMove = (ev: MouseEvent) => {
      const delta = startY - ev.clientY;
      const h = Math.max(60, Math.min(400, startH + delta));
      setLogHeight(h);
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      setLogHeight((h) => { localStorage.setItem("ogn-log-height", String(h)); return h; });
      mapRef.current?.invalidateSize();
    };
    document.body.style.cursor = "row-resize";
    document.body.style.userSelect = "none";
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, [logHeight]);

  // ── Categorize aircraft ──
  const allAircraft = Array.from(aircraftRef.current.entries());

  const isLost = (ac: TrackedAircraft) =>
    ac.position.altitude_m >= GROUND_ALT_M && (now - ac.lastUpdateMs) > LOST_SIGNAL_SEC * 1000;

  // "Danger" = lost signal OR insufficient glide path (while airborne) — FLARM only
  const { latitude: fLat, longitude: fLon, elevation_m: fElev } = airfield;
  const dangerList = allAircraft.filter(([, ac]) =>
    !ac.adsb &&
    ac.position.altitude_m >= GROUND_ALT_M &&
    (isLost(ac) || isDanger(ac.position, units.safeGlideRatio, fLat, fLon, fElev))
  );
  const airborne = allAircraft.filter(([, ac]) =>
    !ac.adsb &&
    ac.position.altitude_m >= GROUND_ALT_M &&
    !isLost(ac) &&
    !isDanger(ac.position, units.safeGlideRatio, fLat, fLon, fElev)
  );
  const adsbAirborne = allAircraft.filter(([, ac]) => ac.adsb && ac.position.altitude_m >= GROUND_ALT_M);
  const ground = allAircraft.filter(([, ac]) => !ac.adsb && ac.position.altitude_m < GROUND_ALT_M);

  const selectedDetail = selectedAircraft
    ? aircraftRef.current.get(selectedAircraft)
    : null;

  const lowAltM = LOW_ALT_FT * 0.3048 + fElev;
  function isLowAlt(alt_m: number): boolean {
    return alt_m >= GROUND_ALT_M && alt_m < lowAltM;
  }

  return (
    <>
      <div className="flex flex-1 min-h-0 rounded-md overflow-hidden" style={{ border: "1px solid var(--color-border)" }}>
        {/* Left column: Map + Flight Log */}
        <div className="flex-1 flex flex-col min-h-0 min-w-0">
          {/* Map */}
          <div className="flex-1 relative min-h-0">
            <div ref={mapContainerRef} className="w-full h-full" />
            <div className="absolute top-2.5 right-2.5 z-[1000] flex flex-col gap-1">
              <button
                onClick={() => {
                  const hv = homeView.lat !== 0 ? homeView : { lat: airfield.latitude, lng: airfield.longitude, zoom: 11 };
                  mapRef.current?.setView([hv.lat, hv.lng], hv.zoom);
                }}
                className="px-2.5 py-1.5 text-xs rounded font-semibold"
                style={{
                  background: "#fff",
                  color: "var(--color-text-primary)",
                  border: "1px solid var(--color-border)",
                  boxShadow: "0 1px 3px rgba(0,0,0,0.15)",
                }}
              >
                HOME
              </button>
              <button
                onClick={() => {
                  const map = mapRef.current;
                  if (!map) return;
                  const c = map.getCenter();
                  const z = map.getZoom();
                  const hv = { lat: c.lat, lng: c.lng, zoom: z };
                  setHomeView(hv);
                  try { localStorage.setItem("ogn-home-view", JSON.stringify(hv)); } catch { /* ignore */ }
                }}
                className="px-2.5 py-1 text-[10px] rounded"
                style={{
                  background: "#fff",
                  color: "var(--color-text-secondary)",
                  border: "1px solid var(--color-border)",
                  boxShadow: "0 1px 3px rgba(0,0,0,0.15)",
                }}
                title="現在のビューをHOMEとして保存"
              >
                保存
              </button>
            </div>
          </div>

          {/* Resize handle: Map ↔ Flight Log */}
          <div
            onMouseDown={startDragLog}
            className="shrink-0 flex items-center justify-center"
            style={{
              height: 6,
              cursor: "row-resize",
              background: "var(--color-border)",
            }}
          >
            <div style={{ width: 32, height: 2, borderRadius: 1, background: "var(--color-text-secondary)", opacity: 0.4 }} />
          </div>

          {/* Flight Log Table */}
          <div
            className="shrink-0 flex flex-col"
            style={{
              height: logHeight,
              background: "var(--color-bg-secondary)",
            }}
          >
            <div
              className="px-3 py-1.5 text-xs font-semibold shrink-0 flex items-center gap-2"
              style={{ background: "var(--color-bg-tertiary)", color: "var(--color-text-primary)", borderBottom: "1px solid var(--color-border)" }}
            >
              フライトログ
              <span className="font-normal" style={{ color: "var(--color-text-secondary)" }}>({flightLog.length}件)</span>
            </div>
            <div
              ref={logTableRef}
              className="overflow-y-auto flex-1"
            >
              <table className="text-xs w-full table-striped" style={{ tableLayout: "auto", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ background: "var(--color-bg-tertiary)", position: "sticky", top: 0, zIndex: 1 }}>
                    <th className="text-left px-1 py-1 font-semibold whitespace-nowrap text-xs" style={{ color: "var(--color-text-primary)", borderBottom: "1px solid var(--color-border)", borderRight: "1px solid var(--color-border)" }}>#</th>
                    <th className="text-left px-1 py-1 font-semibold whitespace-nowrap text-xs" style={{ color: "var(--color-text-primary)", borderBottom: "1px solid var(--color-border)", borderRight: "1px solid var(--color-border)" }}>登録番号</th>
                    <th className="text-left px-1 py-1 font-semibold whitespace-nowrap text-xs" style={{ color: "var(--color-text-primary)", borderBottom: "1px solid var(--color-border)", borderRight: "1px solid var(--color-border)" }}>離陸</th>
                    <th className="text-left px-1 py-1 font-semibold whitespace-nowrap text-xs" style={{ color: "var(--color-text-primary)", borderBottom: "1px solid var(--color-border)", borderRight: "1px solid var(--color-border)" }}>着陸</th>
                    <th className="text-left px-1 py-1 font-semibold whitespace-nowrap text-xs" style={{ color: "var(--color-text-primary)", borderBottom: "1px solid var(--color-border)", borderRight: "1px solid var(--color-border)" }}>飛行時間</th>
                    <th className="text-left px-1 py-1 font-semibold whitespace-nowrap text-xs" style={{ color: "var(--color-text-primary)", borderBottom: "1px solid var(--color-border)", borderRight: "1px solid var(--color-border)" }}>離脱高度</th>
                    <th className="text-left px-1 py-1 font-semibold whitespace-nowrap text-xs" style={{ color: "var(--color-text-primary)", borderBottom: "1px solid var(--color-border)", borderRight: "1px solid var(--color-border)" }}>離脱距離</th>
                    <th className="px-0.5 py-1 text-xs" style={{ borderBottom: "1px solid var(--color-border)" }} />
                  </tr>
                </thead>
                <tbody>
                  {flightLog.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="px-3 py-2 text-center" style={{ color: "var(--color-text-secondary)" }}>
                        フライトデータなし
                      </td>
                    </tr>
                  ) : (
                    flightLog.map((entry, i) => (
                      <tr
                        key={`${entry.deviceId}-${i}`}
                      >
                        <td className="px-1 py-0.5 tabular-nums whitespace-nowrap text-left" style={{ color: "var(--color-text-secondary)", borderBottom: "1px solid var(--color-border)", borderRight: "1px solid var(--color-border)" }}>{i + 1}</td>
                        <td className="px-1 py-0.5 font-semibold whitespace-nowrap text-left" style={{ borderBottom: "1px solid var(--color-border)", borderRight: "1px solid var(--color-border)" }}>{entry.registration}</td>
                        <td className="px-1 py-0.5 tabular-nums whitespace-nowrap text-left" style={{ borderBottom: "1px solid var(--color-border)", borderRight: "1px solid var(--color-border)" }}>
                          <input
                            type="text"
                            value={entry.takeoffTime}
                            onChange={(e) => {
                              const val = e.target.value;
                              if (/^\d{0,2}:?\d{0,2}$/.test(val) || val === "") {
                                const updated = [...flightLog];
                                updated[i] = { ...updated[i], takeoffTime: val };
                                flightLogRef.current = updated;
                                setFlightLog(updated);
                              }
                            }}
                            className="tabular-nums bg-transparent border-b px-0 py-0 text-xs w-[3.2em]"
                            style={{ borderColor: "var(--color-border)", outline: "none", color: "inherit" }}
                          />
                        </td>
                        <td className="px-1 py-0.5 tabular-nums whitespace-nowrap text-left" style={{ borderBottom: "1px solid var(--color-border)", borderRight: "1px solid var(--color-border)" }}>
                          {entry.landingTime != null ? (
                            <input
                              type="text"
                              value={entry.landingTime}
                              onChange={(e) => {
                                const val = e.target.value;
                                if (/^\d{0,2}:?\d{0,2}$/.test(val) || val === "") {
                                  const updated = [...flightLog];
                                  updated[i] = { ...updated[i], landingTime: val };
                                  flightLogRef.current = updated;
                                  setFlightLog(updated);
                                }
                              }}
                              className="tabular-nums bg-transparent border-b px-0 py-0 text-xs w-[3.2em]"
                              style={{ borderColor: "var(--color-border)", outline: "none", color: "inherit" }}
                            />
                          ) : (
                            <span className="font-semibold" style={{ color: "var(--color-success)" }}>飛行中</span>
                          )}
                        </td>
                        <td className="px-1 py-0.5 tabular-nums whitespace-nowrap text-left" style={{ borderBottom: "1px solid var(--color-border)", borderRight: "1px solid var(--color-border)" }}>
                          {calcFlightDuration(entry.takeoffTime, entry.landingTime) || "—"}
                        </td>
                        <td className="px-1 py-0.5 tabular-nums whitespace-nowrap text-left" style={{ borderBottom: "1px solid var(--color-border)", borderRight: "1px solid var(--color-border)" }}>
                          <ReleaseAltInput
                                releaseAlt={entry.releaseAlt}
                                altUnit={units.altitude}
                                onChange={(newAlt) => {
                                  const updated = [...flightLog];
                                  updated[i] = { ...updated[i], releaseAlt: newAlt };
                                  flightLogRef.current = updated;
                                  setFlightLog(updated);
                                }}
                              />
                        </td>
                        <td className="px-1 py-0.5 tabular-nums whitespace-nowrap text-left" style={{ borderBottom: "1px solid var(--color-border)", borderRight: "1px solid var(--color-border)" }}>
                          {entry.releaseDist != null ? formatDistance(entry.releaseDist, units.distance) : "—"}
                        </td>
                        <td className="px-0.5 py-0.5 whitespace-nowrap text-center" style={{ borderBottom: "1px solid var(--color-border)" }}>
                          <button
                            onClick={() => {
                              if (!confirm("本当に消しますか？")) return;
                              const updated = flightLog.filter((_, idx) => idx !== i);
                              flightLogRef.current = updated;
                              setFlightLog(updated);
                            }}
                            className="text-base leading-none hover:opacity-70 cursor-pointer"
                            style={{ color: "var(--color-danger)", filter: "drop-shadow(0 0 1px rgba(211,47,47,0.4))" }}
                            title="削除"
                          >
                            🗑️
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Resize handle: Map ↔ Sidebar */}
        <div
          onMouseDown={startDragSidebar}
          className="shrink-0 flex items-center justify-center"
          style={{
            width: 6,
            cursor: "col-resize",
            background: "var(--color-border)",
          }}
        >
          <div style={{ height: 32, width: 2, borderRadius: 1, background: "var(--color-text-secondary)", opacity: 0.4 }} />
        </div>

        {/* Status view sidebar */}
        <div
          className="shrink-0 flex flex-col overflow-y-auto"
          style={{
            width: sidebarWidth,
            background: "var(--color-bg-secondary)",
          }}
        >
          {/* Selected detail */}
          {selectedDetail && (() => {
            const selDb = selectedAircraft ? lookupDbRecord(aircraftDbRef.current, selectedAircraft, selectedDetail.position.glider_id) : undefined;
            const selGliderType = selDb?.glider_type || selectedDetail.position.glider_type;
            const selRegistration = selDb?.registration || selectedDetail.position.glider_id;
            const selCompId = selDb?.competition_id || selectedDetail.position.competition_id;
            const selPilot = selDb?.pilot || selectedDetail.position.pilot;
            const selAircraftType = selDb?.aircraft_type;
            const typeLabel = selAircraftType ? (AIRCRAFT_TYPE_OPTIONS.find(o => o.value === selAircraftType)?.label) : undefined;
            return (
            <div className="p-3" style={{ borderBottom: "1px solid var(--color-border)" }}>
              <div className="flex items-center justify-between mb-2">
                <span className="text-base font-bold" style={{ color: "var(--color-accent)" }}>
                  {selCompId || selRegistration || selectedAircraft}
                </span>
                <button
                  onClick={() => setSelectedAircraft(null)}
                  className="text-xs px-2 py-0.5 rounded"
                  style={{
                    background: "var(--color-bg-tertiary)",
                    color: "var(--color-text-secondary)",
                    border: "1px solid var(--color-border)",
                  }}
                >
                  閉じる
                </button>
              </div>
              {selGliderType && (
                <DetailRow label="機種名" value={selGliderType} />
              )}
              {selRegistration && (
                <DetailRow label="登録番号" value={selRegistration} />
              )}
              {selCompId && (
                <DetailRow label="CN" value={selCompId} />
              )}
              {typeLabel && (
                <DetailRow label="航空機タイプ" value={typeLabel} />
              )}
              {selPilot && (
                <DetailRow label="パイロット" value={selPilot} />
              )}
              <DetailRow label="高度" value={formatAltitude(selectedDetail.position.altitude_m, units.altitude)} />
              <DetailRow label="速度" value={formatSpeed(selectedDetail.position.ground_speed_ms, units.speed)} />
              <DetailRow label="上昇率" value={formatClimbRate(selectedDetail.position.climb_rate_ms, units.climbRate)} />
              <DetailRow label="方位" value={`${selectedDetail.position.heading_deg.toFixed(0)}°`} />
              <DetailRow label="旋回" value={`${selectedDetail.position.turn_rate_degs.toFixed(1)}°/s`} />
              <DetailRow
                label="パス(L/D)"
                value={(() => {
                  const h = selectedDetail.position.altitude_m - fElev;
                  if (h <= 0) return "—";
                  const d = haversineM(fLat, fLon,
                    selectedDetail.position.latitude, selectedDetail.position.longitude);
                  return `${(d / h).toFixed(1)} (必要 ≤${units.safeGlideRatio})`;
                })()}
              />
            </div>
            );
          })()}

          {/* Danger section (通信途絶 / パス不足) */}
          {dangerList.length > 0 && (
            <div style={{ borderBottom: "1px solid var(--color-border)" }}>
              <div
                className="px-3 py-1.5 text-xs font-semibold flex items-center gap-1.5"
                style={{ background: "var(--color-danger-dim)", color: COLOR_DANGER }}
              >
                <span className="inline-block w-2 h-2 rounded-full" style={{ background: COLOR_DANGER }} />
                警告 ({dangerList.length})
              </div>
              {dangerList.map(([id, ac]) => {
                const lost = isLost(ac);
                const secAgo = lost ? Math.round((now - ac.lastUpdateMs) / 1000) : 0;
                const h = ac.position.altitude_m - fElev;
                const d = haversineM(fLat, fLon, ac.position.latitude, ac.position.longitude);
                const ratio = h > 0 ? (d / h).toFixed(1) : "—";
                return (
                  <div
                    key={id}
                    onClick={() => {
                      setSelectedAircraft(id);
                      mapRef.current?.setView([ac.position.latitude, ac.position.longitude], 13);
                    }}
                    className="flex items-center gap-2 px-3 py-1.5 text-[13px] cursor-pointer danger-blink"
                    style={{ borderBottom: "1px solid var(--color-border)", color: COLOR_DANGER }}
                  >
                    <span className="font-semibold min-w-[65px]">{ac.label}</span>
                    <span className="text-[11px] flex-1" style={{ opacity: 0.7 }}>
                      {lost ? `途絶 ${secAgo}秒` : `L/D ${ratio}`}
                    </span>
                    <span className="tabular-nums text-xs font-bold">
                      {formatAltitude(ac.position.altitude_m, units.altitude)}
                    </span>
                  </div>
                );
              })}
            </div>
          )}

          {/* Airborne (上空) */}
          <div style={{ borderBottom: "1px solid var(--color-border)" }}>
            <div
              className="px-3 py-1.5 text-xs font-semibold flex items-center gap-1.5"
              style={{ background: "var(--color-bg-tertiary)", color: "var(--color-text-primary)" }}
            >
              <span className="inline-block w-2 h-2 rounded-full" style={{ background: COLOR_NORMAL }} />
              上空 ({airborne.length})
            </div>
            {airborne.length === 0 ? (
              <div className="px-3 py-4 text-center text-xs" style={{ color: "var(--color-text-secondary)" }}>
                上空の機体なし
              </div>
            ) : (
              airborne
                .sort(([, a], [, b]) => b.position.altitude_m - a.position.altitude_m)
                .map(([id, ac]) => {
                  const low = isLowAlt(ac.position.altitude_m);
                  return (
                    <StatusItem
                      key={id}
                      id={id}
                      ac={ac}
                      selected={selectedAircraft === id}
                      units={units}
                      low={low}
                      onClick={() => {
                        setSelectedAircraft(id);
                        mapRef.current?.setView([ac.position.latitude, ac.position.longitude], 13);
                      }}
                      dbGliderType={lookupDbRecord(aircraftDbRef.current, id, ac.position.glider_id)?.glider_type}
                    />
                  );
                })
            )}
          </div>

          {/* ADS-B / Mode-S */}
          {(adsbAirborne.length > 0 || noPositionAircraft.length > 0) && (
            <div style={{ borderBottom: "1px solid var(--color-border)" }}>
              <div
                className="px-3 py-1.5 text-xs font-semibold flex items-center gap-1.5"
                style={{ background: "var(--color-bg-tertiary)", color: COLOR_ADSB }}
              >
                <span className="inline-block w-2 h-2 rounded-full" style={{ background: COLOR_ADSB }} />
                ADS-B / Mode-S ({adsbAirborne.length + noPositionAircraft.length})
              </div>
              {/* Aircraft with position (on map) */}
              {adsbAirborne
                .sort(([, a], [, b]) => b.position.altitude_m - a.position.altitude_m)
                .map(([id, ac]) => {
                  const c = adsbColor(ac.position);
                  return (
                    <div
                      key={id}
                      onClick={() => {
                        setSelectedAircraft(id);
                        mapRef.current?.setView([ac.position.latitude, ac.position.longitude], 13);
                      }}
                      className="flex items-center gap-2 px-3 py-1.5 text-[13px] cursor-pointer transition-colors"
                      style={{
                        borderBottom: "1px solid var(--color-border)",
                        background: selectedAircraft === id ? "var(--color-accent-light)" : "transparent",
                      }}
                    >
                      <span className="font-semibold min-w-[65px]" style={{ color: c }}>
                        {ac.label}
                      </span>
                      <span className="text-[11px] flex-1" style={{ color: "var(--color-text-secondary)" }}>
                        {ac.position.hex || id.slice(0, 6)}
                      </span>
                      <span className="tabular-nums text-xs text-right min-w-[55px]" style={{ color: c }}>
                        {formatAltitude(ac.position.altitude_m, units.altitude)}
                      </span>
                    </div>
                  );
                })}
              {/* Aircraft without position (sidebar only) */}
              {noPositionAircraft
                .sort((a, b) => b.altitude_m - a.altitude_m)
                .map((pos) => {
                  const label = pos.flight || pos.hex || "????";
                  return (
                    <div
                      key={pos.hex}
                      className="flex items-center gap-2 px-3 py-1.5 text-[13px]"
                      style={{ borderBottom: "1px solid var(--color-border)" }}
                    >
                      <span className="font-semibold min-w-[65px]" style={{ color: COLOR_MODES }}>
                        {label}
                      </span>
                      <span className="text-[11px] flex-1" style={{ color: "var(--color-text-secondary)" }}>
                        位置不明
                      </span>
                      <span className="tabular-nums text-xs text-right min-w-[55px]" style={{ color: COLOR_MODES }}>
                        {formatAltitude(pos.altitude_m, units.altitude)}
                      </span>
                    </div>
                  );
                })}
            </div>
          )}

          {/* Ground (地上) */}
          <div>
            <div
              className="px-3 py-1.5 text-xs font-semibold flex items-center gap-1.5"
              style={{ background: "var(--color-bg-tertiary)", color: "var(--color-text-secondary)" }}
            >
              <span className="inline-block w-2 h-2 rounded-full" style={{ background: COLOR_GROUND }} />
              地上 ({ground.length})
            </div>
            {ground.length === 0 ? (
              <div className="px-3 py-4 text-center text-xs" style={{ color: "var(--color-text-secondary)" }}>
                地上の機体なし
              </div>
            ) : (
              ground.map(([id, ac]) => (
                <StatusItem
                  key={id}
                  id={id}
                  ac={ac}
                  selected={selectedAircraft === id}
                  units={units}
                  low={false}
                  onClick={() => {
                    setSelectedAircraft(id);
                    mapRef.current?.setView([ac.position.latitude, ac.position.longitude], 14);
                  }}
                  dbGliderType={lookupDbRecord(aircraftDbRef.current, id, ac.position.glider_id)?.glider_type}
                />
              ))
            )}
          </div>

          {/* Legend */}
          <div className="mt-auto px-3 py-2" style={{ borderTop: "1px solid var(--color-border)", background: "var(--color-bg-tertiary)" }}>
            <div className="text-xs font-semibold mb-1.5" style={{ color: "var(--color-text-primary)" }}>
              凡例
            </div>
            <div className="grid grid-cols-1 gap-1 text-xs">
              <div className="flex items-center gap-2">
                <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: COLOR_NORMAL }} />
                <span style={{ color: "var(--color-text-secondary)" }}>FLARM（通常）</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: COLOR_LOW }} />
                <span style={{ color: "var(--color-text-secondary)" }}>FLARM（低高度）</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: COLOR_DANGER }} />
                <span style={{ color: "var(--color-text-secondary)" }}>FLARM（警告）</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: COLOR_ADSB }} />
                <span style={{ color: "var(--color-text-secondary)" }}>ADS-B</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: COLOR_MODES }} />
                <span style={{ color: "var(--color-text-secondary)" }}>Mode-S/C</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Bottom status bar */}
      <div
        className="flex items-center gap-4 px-3 shrink-0 text-xs rounded-md"
        style={{
          height: 26,
          background: "var(--color-bg-tertiary)",
          border: "1px solid var(--color-border)",
          color: "var(--color-text-secondary)",
        }}
      >
        <span className="flex items-center gap-1.5">
          <span
            className="inline-block w-2 h-2 rounded-full"
            style={{ background: connected ? "var(--color-success)" : "var(--color-danger)" }}
          />
          MQTT {connected ? "接続中" : "切断"}
        </span>
        <span>
          機体数: <strong style={{ color: "var(--color-accent)" }}>{aircraftCount}</strong>
        </span>
        {receiverStatus?.simulated && receiverStatus.simulator && (
          <span
            className="px-2 py-0.5 rounded font-semibold"
            style={{ background: "var(--color-warning-dim)", color: "var(--color-warning)" }}
          >
            履歴再生 {receiverStatus.simulator.speed}x
            {receiverStatus.simulator.loop && " ループ"} — {receiverStatus.simulator.progress_pct.toFixed(0)}%
          </span>
        )}
        {receiverStatus && !receiverStatus.simulated && receiverStatus.online && (
          <span
            className="px-2 py-0.5 rounded font-semibold"
            style={{ background: "var(--color-success-dim)", color: "var(--color-success)" }}
          >
            リアルタイム再生
          </span>
        )}
      </div>
    </>
  );
}

function buildTooltip(
  label: string,
  pos: AircraftPosition,
  units: { altitude: "m" | "ft"; speed: "km/h" | "knot" },
  isAdsb?: boolean,
): string {
  const alt = formatAltitude(pos.altitude_m, units.altitude);
  const spd = formatSpeed(pos.ground_speed_ms, units.speed);
  if (isAdsb) {
    const c = pos.adsb_mode === "adsb" ? COLOR_ADSB : COLOR_MODES;
    return `<strong style="color:${c}">${label}</strong><br/>${alt} ${spd}`;
  }
  return `<strong>${label}</strong><br/>${alt} ${spd}`;
}

function StatusItem({
  id,
  ac,
  selected,
  units,
  low,
  onClick,
  dbGliderType,
}: {
  id: string;
  ac: TrackedAircraft;
  selected: boolean;
  units: { altitude: "m" | "ft"; speed: "km/h" | "knot" };
  low: boolean;
  onClick: () => void;
  dbGliderType?: string;
}) {
  const pos = ac.position;
  const labelColor = low ? COLOR_LOW : COLOR_NORMAL;
  const altTextColor = low ? COLOR_LOW : "var(--color-text-primary)";

  return (
    <div
      onClick={onClick}
      className={`flex items-center gap-2 px-3 py-1.5 text-[13px] cursor-pointer transition-colors ${
        selected ? "status-blink" : ""
      }`}
      style={{
        borderBottom: "1px solid var(--color-border)",
        background: selected
          ? "var(--color-accent-light)"
          : low
          ? "var(--color-warning-dim)"
          : "transparent",
        outline: selected ? "1px solid var(--color-accent)" : "none",
      }}
    >
      <span className="font-semibold min-w-[65px]" style={{ color: labelColor }}>
        {ac.label}
      </span>
      <span className="text-[11px] flex-1" style={{ color: "var(--color-text-secondary)" }}>
        {dbGliderType || pos.glider_type || id.slice(0, 6)}
      </span>
      <span
        className="tabular-nums text-xs text-right min-w-[55px]"
        style={{ color: altTextColor, fontWeight: low ? 700 : 500 }}
      >
        {formatAltitude(pos.altitude_m, units.altitude)}
      </span>
    </div>
  );
}

function ReleaseAltInput({
  releaseAlt,
  altUnit,
  onChange,
}: {
  releaseAlt: number | null;
  altUnit: "m" | "ft";
  onChange: (alt: number | null) => void;
}) {
  const displayVal = releaseAlt != null
    ? (altUnit === "ft" ? Math.round(releaseAlt * 3.28084).toString() : releaseAlt.toString())
    : "";
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(displayVal);

  return (
    <>
      <input
        type="text"
        value={editing ? draft : displayVal}
        placeholder="..."
        onFocus={() => { setEditing(true); setDraft(displayVal); }}
        onChange={(e) => {
          const val = e.target.value;
          if (val === "" || /^\d+$/.test(val)) setDraft(val);
        }}
        onBlur={() => {
          setEditing(false);
          if (draft === "") {
            onChange(null);
          } else {
            const num = parseInt(draft, 10);
            if (!isNaN(num)) {
              onChange(altUnit === "ft" ? num / 3.28084 : num);
            }
          }
        }}
        className="tabular-nums bg-transparent border-b px-0 py-0 text-xs text-right w-[4em]"
        style={{ borderColor: "var(--color-border)", outline: "none", color: "inherit" }}
      />
      <span className="text-[10px] ml-0.5" style={{ color: "var(--color-text-secondary)" }}>
        {altUnit === "ft" ? "ft" : "m"}
      </span>
    </>
  );
}

function DetailRow({ label, value }: { label: string; value?: string | number | null }) {
  if (!value && value !== 0) return null;
  return (
    <div className="flex justify-between py-0.5 text-xs">
      <span style={{ color: "var(--color-text-secondary)" }}>{label}</span>
      <span className="font-medium tabular-nums">{value}</span>
    </div>
  );
}
