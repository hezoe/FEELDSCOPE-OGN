import { NextRequest, NextResponse } from "next/server";

// Open OGN: ogn.ezoe.net(VPS上の OGN 集約 = APRS-IS→SQLite)から空港周辺の OGN 機を
// 取得し、FEELDSCOPE のローカル OGN 受信とマージする。表示は「ローカル優先」で、
// 同一機(ICAO/FLARM 6桁hex一致)はローカル側だけ表示する(重複を出さない)。
// ローカル受信の圏外にいる広域の OGN トラフィックを、ネットワーク経由で補うのが狙い。
// ogn.ezoe.net 側で DDB opt-out(tracked=0) と RND(匿名) は既に除外済み。
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const SOURCE = "https://ogn.ezoe.net/api/positions?since=60";
const RADIUS_NM = 50;              // 空港からの取得半径(海里)
const RADIUS_M = RADIUS_NM * 1852;
const CACHE_MS = 8_000;            // サーバ側 再取得の最短間隔(多クライアント共有)
const UA = "FEELDSCOPE Open OGN (+https://github.com/hezoe/FEELDSCOPE-OGN)";

interface OgnPos {
  device_id?: string;
  lat?: number;
  lon?: number;
  altitude_m?: number;
  ground_speed?: number;   // km/h
  track?: number;          // deg
  climb_rate?: number;     // m/s
  aircraft_type?: number;  // OGN aircraft type code
  registration?: string | null;
  cn?: string | null;
  model?: string | null;
  ts?: string;
}

let cache: { at: number; center: string; aircraft: unknown[] } = { at: 0, center: "", aircraft: [] };
let inflight: Promise<void> | null = null;

function haversineM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000, r = Math.PI / 180;
  const dLat = (lat2 - lat1) * r, dLon = (lon2 - lon1) * r;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

async function refresh(lat: number, lon: number): Promise<void> {
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), 12_000);
  let rows: OgnPos[] = [];
  try {
    const r = await fetch(SOURCE, { headers: { "User-Agent": UA, Accept: "application/json" }, signal: ctrl.signal });
    if (r.ok) {
      const d = await r.json();
      if (Array.isArray(d?.aircraft)) rows = d.aircraft as OgnPos[];
    }
  } catch {
    return; // 失敗時は既存キャッシュ維持
  } finally {
    clearTimeout(to);
  }
  // device_id ごとに最新の1点だけ採用
  const latest = new Map<string, OgnPos>();
  for (const p of rows) {
    if (!p.device_id || p.lat == null || p.lon == null) continue;
    const prev = latest.get(p.device_id);
    if (!prev || (p.ts || "") > (prev.ts || "")) latest.set(p.device_id, p);
  }
  // 空港から RADIUS_NM 以内だけ
  const out = [];
  for (const p of latest.values()) {
    if (haversineM(lat, lon, p.lat!, p.lon!) > RADIUS_M) continue;
    out.push({
      device_id: p.device_id,
      hex: p.device_id,
      registration: p.registration || null,
      cn: p.cn || null,
      model: p.model || null,
      latitude: Math.round(p.lat! * 1e5) / 1e5,
      longitude: Math.round(p.lon! * 1e5) / 1e5,
      altitude_m: p.altitude_m != null ? Math.round(p.altitude_m) : null,
      heading_deg: p.track ?? 0,
      ground_speed_ms: p.ground_speed != null ? Math.round((p.ground_speed / 3.6) * 10) / 10 : 0, // km/h -> m/s
      aircraft_type: p.aircraft_type ?? null,
    });
  }
  cache = { at: Date.now(), center: `${lat.toFixed(2)},${lon.toFixed(2)}`, aircraft: out };
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const latS = sp.get("lat");
  const lonS = sp.get("lon");
  const lat = latS ? Number(latS) : NaN;
  const lon = lonS ? Number(lonS) : NaN;
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    return NextResponse.json({ error: "lat/lon required" }, { status: 400 });
  }
  const centerKey = `${lat.toFixed(2)},${lon.toFixed(2)}`;
  if (centerKey !== cache.center || Date.now() - cache.at > CACHE_MS) {
    if (!inflight) inflight = refresh(lat, lon).finally(() => { inflight = null; });
    try { await inflight; } catch { /* ignore */ }
  }
  return NextResponse.json({
    now: new Date().toISOString(),
    last_poll: cache.at ? new Date(cache.at).toISOString() : null,
    center: { lat, lon },
    radius_nm: RADIUS_NM,
    radius_miles: RADIUS_NM, // マイル=海里で運用
    count: cache.aircraft.length,
    aircraft: cache.aircraft,
  });
}
