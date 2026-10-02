import { NextResponse } from "next/server";
import https from "node:https";
import zlib from "node:zlib";

// 風の流れ: ogn.ezoe.net が整形した気象庁の風を中継し、滑空場の周辺だけ切り出して返す。
//   地上 = 気象庁アメダスの実測(10分平均の風向・風速)を約10km 格子に補間したもの(10分毎更新)
//   上空 = 気象庁 MSM の予報(975hPa≈1,000ft / 950hPa≈2,000ft / 850hPa≈5,000ft、約10km 格子)
// 気象庁(の非公式 JSON)や Open-Meteo へは ogn.ezoe.net だけが取りに行く(各機から直接は取らない)。
//   GET /api/wind/meta                       各高さの時刻・種別(obs=観測 / forecast=予報)
//   GET /api/wind/<sfc|975|950|850>?lat=&lon= leaflet-velocity 用の U/V 格子(滑空場の周辺)
//   GET /api/wind/amedas?lat=&lon=           アメダス観測点ごとの風(凡例の「近くのアメダス」用)
// 外向き通信は radar / open-adsb と同じく node:https + IPv4 直行(Next.js の fetch は Happy Eyeballs で失敗しうるため)。

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const SOURCE = process.env.FEELDSCOPE_WIND_SOURCE || "https://ogn.ezoe.net/api/wind";
const UA = "FEELDSCOPE wind (+https://github.com/hezoe/FEELDSCOPE-OGN)";
// 取り直す間隔。地上(アメダス)は10分毎、上空(MSM)は3時間毎の予報なので長めに持つ
const TTL_MS: Record<string, number> = { meta: 60_000, sfc: 120_000, amedas: 120_000, "975": 600_000, "950": 600_000, "850": 600_000 };
const CROP_LAT = 2.5, CROP_LON = 3.5;   // 滑空場から南北±2.5°・東西±3.5°(約280km×630km)

type GridRecord = {
  header: { nx: number; ny: number; la1: number; lo1: number; la2: number; lo2: number; dx: number; dy: number; [k: string]: unknown };
  data: (number | null)[];
};
type Station = { lat: number; lon: number; [k: string]: unknown };

const cache = new Map<string, { at: number; json: unknown }>();
const inflight = new Map<string, Promise<unknown>>();

function getJsonV4(url: string, timeoutMs: number): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      family: 4,
      headers: { "User-Agent": UA, Accept: "application/json", "Accept-Encoding": "gzip" },
      timeout: timeoutMs,
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => {
        if (res.statusCode !== 200) { reject(new Error(`HTTP ${res.statusCode}`)); return; }
        try {
          let buf = Buffer.concat(chunks);
          if (res.headers["content-encoding"] === "gzip") buf = zlib.gunzipSync(buf);
          resolve(JSON.parse(buf.toString("utf8")));
        } catch (e) { reject(e); }
      });
    });
    req.on("timeout", () => req.destroy(Object.assign(new Error("request timeout"), { code: "ETIMEDOUT" })));
    req.on("error", reject);
  });
}

async function upstream(level: string): Promise<unknown> {
  const hit = cache.get(level);
  if (hit && Date.now() - hit.at < TTL_MS[level]) return hit.json;
  let p = inflight.get(level);
  if (!p) {
    p = getJsonV4(`${SOURCE}/${level}`, 20_000)
      .then((json) => { cache.set(level, { at: Date.now(), json }); return json; })
      .finally(() => inflight.delete(level));
    inflight.set(level, p);
  }
  try {
    return await p;
  } catch (e) {
    if (hit) return hit.json;          // 取り直せなければ前回の値
    throw e;
  }
}

// 格子(北の行から南へ、西から東へ)を滑空場の周辺だけに切り出す
function cropGrid(recs: GridRecord[], lat: number, lon: number): GridRecord[] | null {
  const h = recs[0].header;
  const i0 = Math.max(0, Math.floor((h.la1 - (lat + CROP_LAT)) / h.dy));
  const i1 = Math.min(h.ny - 1, Math.ceil((h.la1 - (lat - CROP_LAT)) / h.dy));
  const j0 = Math.max(0, Math.floor((lon - CROP_LON - h.lo1) / h.dx));
  const j1 = Math.min(h.nx - 1, Math.ceil((lon + CROP_LON - h.lo1) / h.dx));
  if (i1 - i0 < 1 || j1 - j0 < 1) return null;   // 滑空場が領域の外
  const nx = j1 - j0 + 1, ny = i1 - i0 + 1;
  const la1 = h.la1 - i0 * h.dy, lo1 = h.lo1 + j0 * h.dx;
  return recs.map((r) => {
    const data: (number | null)[] = [];
    for (let i = i0; i <= i1; i++) data.push(...r.data.slice(i * h.nx + j0, i * h.nx + j1 + 1));
    return {
      header: { ...r.header, nx, ny, la1, lo1, la2: la1 - (ny - 1) * h.dy, lo2: lo1 + (nx - 1) * h.dx },
      data,
    };
  });
}

export async function GET(req: Request, ctx: { params: Promise<{ level: string }> }) {
  const { level } = await ctx.params;
  if (!(level in TTL_MS)) return NextResponse.json({ error: "unknown level" }, { status: 404 });
  const q = new URL(req.url).searchParams;
  const lat = Number(q.get("lat")), lon = Number(q.get("lon"));
  const hasPos = q.has("lat") && q.has("lon") && Number.isFinite(lat) && Number.isFinite(lon);
  let json: unknown;
  try {
    json = await upstream(level);
  } catch {
    return NextResponse.json({ error: "wind data unavailable" }, { status: 503 });
  }
  const headers = { "Cache-Control": "public, max-age=60" };
  if (level === "meta" || !hasPos) return NextResponse.json(json, { headers });
  if (level === "amedas") {
    const a = json as { time?: string; stations?: Station[] };
    const stations = (a.stations || []).filter((s) => Math.abs(s.lat - lat) <= CROP_LAT && Math.abs(s.lon - lon) <= CROP_LON);
    return NextResponse.json({ time: a.time, stations }, { headers });
  }
  const cropped = Array.isArray(json) && json.length === 2 ? cropGrid(json as GridRecord[], lat, lon) : null;
  if (!cropped) return NextResponse.json({ error: "out of range" }, { status: 404 });
  return NextResponse.json(cropped, { headers });
}
