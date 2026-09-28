import { NextResponse } from "next/server";
import https from "node:https";

// 雨雲レーダー: 気象庁「高解像度降水ナウキャスト」(hrpns・5分毎・約1km)の最新時刻とタイルURLを返す。
// 最新時刻の一覧 targetTimes_N1.json は CORS 非対応のためこのサーバが中継する(60秒キャッシュ)。
// タイル画像はブラウザが気象庁から直接読む(<img> なので CORS 不要)。表示には出典「気象庁」が必要。
// 外向き通信は open-adsb と同じく node:https + IPv4 直行(Next.js の fetch は Happy Eyeballs で失敗しうるため)。

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const TIMES_URL = "https://www.jma.go.jp/bosai/jmatile/data/nowc/targetTimes_N1.json";
const CACHE_MS = 60_000;
const UA = "FEELDSCOPE rain radar (+https://github.com/hezoe/FEELDSCOPE-OGN)";

type Radar = { basetime: string; validtime: string; tile: string };
let cache: { at: number; data: Radar | null } = { at: 0, data: null };

function getJsonV4(url: string, timeoutMs: number): Promise<{ status: number; json: unknown }> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      family: 4,
      headers: { "User-Agent": UA, Accept: "application/json" },
      timeout: timeoutMs,
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => {
        const status = res.statusCode || 0;
        if (status !== 200) { resolve({ status, json: null }); return; }
        try { resolve({ status, json: JSON.parse(Buffer.concat(chunks).toString("utf8")) }); }
        catch (e) { reject(e); }
      });
    });
    req.on("timeout", () => req.destroy(Object.assign(new Error("request timeout"), { code: "ETIMEDOUT" })));
    req.on("error", reject);
  });
}

async function refresh(): Promise<void> {
  try {
    const { status, json } = await getJsonV4(TIMES_URL, 10_000);
    if (status !== 200 || !Array.isArray(json)) return;
    const t = (json as Array<{ basetime?: string; validtime?: string; elements?: string[] }>)
      .find((x) => Array.isArray(x?.elements) && x.elements.includes("hrpns"));
    if (!t || !/^\d{14}$/.test(t.basetime || "") || !/^\d{14}$/.test(t.validtime || "")) return;
    cache = {
      at: Date.now(),
      data: {
        basetime: t.basetime!, validtime: t.validtime!,   // UTC(YYYYMMDDhhmmss)
        tile: `https://www.jma.go.jp/bosai/jmatile/data/nowc/${t.basetime}/none/${t.validtime}/surf/hrpns/{z}/{x}/{y}.png`,
      },
    };
  } catch {
    /* 取得失敗時は前回値を返し続ける */
  }
}

export async function GET() {
  if (!cache.data || Date.now() - cache.at > CACHE_MS) await refresh();
  if (!cache.data) return NextResponse.json({ error: "radar unavailable" }, { status: 503 });
  return NextResponse.json(cache.data, { headers: { "Cache-Control": "public, max-age=60" } });
}
