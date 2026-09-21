import { NextRequest, NextResponse } from "next/server";

// Open ADS-B: 公開の adsb.lol から空港周辺(半径250nm)の ADS-B 機を取得する。
// 受信機やローカルの tar1090 は不要。設定画面の「OpenなADS-Bを追加」ON のとき
// フロント(FlightMap)がこのエンドポイントをポーリングし、受信機不要で表示する。
//
// - サーバ側で1回だけ adsb.lol を叩き(=多クライアントで共有)、短時間キャッシュ。
// - 直近10分の位置を hex 単位でメモリ保持して航跡(trail)を返す。
// - フライトログには記録しない(表示のみ・OGN/FLARM とは別系統)。
// データ元: adsb.lol (ODbL, 非商用・要 attribution)。

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// 空港からの表示半径。マイル=海里で運用するため 20マイル = 20海里(adsb.lol の point 半径単位=海里)。
const RADIUS_NM = 20;
const CACHE_MS = 8_000;      // adsb.lol 再取得の最短間隔(サーバ側共有キャッシュ)
const TRAIL_MS = 600_000;    // 航跡保持 = 過去10分
const STALE_MS = 60_000;     // 直近60秒 受信の無い機体は返さない
const UA = "FEELDSCOPE Open ADS-B (+https://github.com/hezoe/FEELDSCOPE-OGN)";

interface AdsbLolAircraft {
  hex?: string;
  flight?: string;
  r?: string;
  t?: string;
  lat?: number;
  lon?: number;
  alt_baro?: number | "ground";
  alt_geom?: number;
  gs?: number;
  track?: number;
  true_heading?: number;
  mag_heading?: number;
  seen_pos?: number;
}

interface OpenAdsbRecord {
  last: {
    hex: string;
    flight: string | null;
    reg: string | null;
    type: string | null;
    lat: number;
    lon: number;
    altitude_m: number;
    heading_deg: number;
    ground_speed_ms: number;
    seen_at: number;
  };
  trail: [number, number, number][]; // [tMs, lat, lon]
}

// モジュールスコープの共有状態(同一 Node プロセス内で全リクエスト共有)
const store = new Map<string, OpenAdsbRecord>();
let lastPoll = 0;
let lastCenterKey = "";
let inflight: Promise<void> | null = null;

function altMeters(ac: AdsbLolAircraft): number {
  const a = ac.alt_baro ?? ac.alt_geom;
  if (a === "ground") return 0;
  if (a == null) return 0;
  const n = Number(a);
  return Number.isFinite(n) ? Math.round(n * 0.3048) : 0; // ft -> m
}

async function pollAdsbLol(lat: number, lon: number): Promise<void> {
  const url = `https://api.adsb.lol/v2/point/${lat}/${lon}/${RADIUS_NM}`;
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), 12_000);
  let list: AdsbLolAircraft[] = [];
  try {
    const r = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" }, signal: ctrl.signal });
    if (r.ok) {
      const d = await r.json();
      if (Array.isArray(d?.ac)) list = d.ac as AdsbLolAircraft[];
    }
  } catch {
    return; // 失敗時は既存キャッシュを維持
  } finally {
    clearTimeout(to);
  }

  const now = Date.now();
  for (const ac of list) {
    const hex = (ac.hex || "").trim().toLowerCase();
    if (!hex || ac.lat == null || ac.lon == null) continue;
    const rlat = Math.round(ac.lat * 1e5) / 1e5;
    const rlon = Math.round(ac.lon * 1e5) / 1e5;
    const track = ac.track ?? ac.true_heading ?? ac.mag_heading ?? 0;
    const rec = store.get(hex) || { trail: [] as [number, number, number][], last: undefined as unknown as OpenAdsbRecord["last"] };
    rec.last = {
      hex,
      flight: (ac.flight || "").trim() || null,
      reg: ac.r || null,
      type: ac.t || null,
      lat: rlat,
      lon: rlon,
      altitude_m: altMeters(ac),
      heading_deg: track,
      ground_speed_ms: ac.gs != null ? Math.round(ac.gs * 0.514444 * 10) / 10 : 0, // kt -> m/s
      seen_at: now,
    };
    const t = rec.trail;
    const p = t[t.length - 1];
    if (!p || p[1] !== rlat || p[2] !== rlon) t.push([now, rlat, rlon]);
    while (t.length && now - t[0][0] > TRAIL_MS) t.shift();
    store.set(hex, rec);
  }
  // 10分以上 更新の無い機体は破棄
  for (const [hex, rec] of store) {
    if (now - (rec.last?.seen_at ?? 0) > TRAIL_MS) store.delete(hex);
  }
  lastPoll = now;
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

  const now = Date.now();
  const centerKey = `${lat.toFixed(2)},${lon.toFixed(2)}`;
  // 中心が変わったら即時再取得。それ以外はキャッシュ間隔で間引く。
  if (centerKey !== lastCenterKey || now - lastPoll > CACHE_MS) {
    lastCenterKey = centerKey;
    if (!inflight) {
      inflight = pollAdsbLol(lat, lon).finally(() => { inflight = null; });
    }
    try { await inflight; } catch { /* ignore */ }
  }

  const aircraft = [];
  for (const rec of store.values()) {
    const l = rec.last;
    if (!l || Date.now() - l.seen_at > STALE_MS) continue;
    aircraft.push({
      device_id: "ADSB" + l.hex.toUpperCase(),
      hex: l.hex,
      flight: l.flight,
      reg: l.reg,
      type: l.type,
      latitude: l.lat,
      longitude: l.lon,
      altitude_m: l.altitude_m,
      heading_deg: l.heading_deg,
      ground_speed_ms: l.ground_speed_ms,
      adsb_mode: "adsb" as const,
      trail: rec.trail.filter((p) => Date.now() - p[0] <= TRAIL_MS).map((p) => [p[1], p[2]] as [number, number]),
    });
  }

  return NextResponse.json({
    now: new Date().toISOString(),
    last_poll: lastPoll ? new Date(lastPoll).toISOString() : null,
    center: { lat, lon },
    radius_nm: RADIUS_NM,
    radius_miles: RADIUS_NM, // マイル=海里で運用
    count: aircraft.length,
    aircraft,
  });
}
