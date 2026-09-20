import { NextResponse } from "next/server";
import { clientIpFromRequest } from "@/lib/auth";
import {
  getFlightLog,
  getPhases,
  resetFlightLog,
  setFlightLog,
  startFlightTracker,
  type FlightLogEntry,
} from "@/lib/flight-tracker";

// 検知は instrumentation.ts から起動されるが、そこが走らない構成でも
// 動くよう、このルートが読み込まれた時点でも起動しておく（二重起動はしない）。
startFlightTracker();


/**
 * 飛行ログを書き換えた記録を journal に残す。
 *
 * なぜ要るか:
 * 飛行ログの差し替え(set)と全消去(reset)は無認証で誰でも呼べる。場内LANでの
 * 運用を前提にした設計なので認証は付けないが、記録が消えたり書き換わったりした
 * ときに「いつ・どこから・何が起きたか」を後から追えるようにしておく。
 * 2026-09-20 に、手編集が受信側の検知結果を上書きして離脱高度が1件消えたが、
 * 痕跡が無いため原因の特定に journal との突き合わせが必要だった。
 *
 * 地図の時刻欄は1文字打つごとに set を呼ぶので、そのまま出すと journal が
 * 埋まる。件数と破壊的変更の有無が同じ行は短時間まとめて1行にする。
 */
let lastSetKey = "";
let lastSetAtMs = 0;
const SET_LOG_COALESCE_MS = 5000;

function logFlightLogSet(ip: string, before: FlightLogEntry[], after: FlightLogEntry[]): void {
  const beforeById = new Map(before.map((f) => [f.id, f]));
  const afterById = new Map(after.map((f) => [f.id, f]));

  const removed = before.filter((f) => !afterById.has(f.id));
  const added = after.filter((f) => !beforeById.has(f.id));

  // 値が入っていたのに空になった項目。取り違えより気づきにくいので個別に出す
  const cleared: string[] = [];
  for (const a of after) {
    const b = beforeById.get(a.id);
    if (!b) continue;
    const who = a.registration || a.deviceId;
    if (b.landingTime && !a.landingTime) cleared.push(`${who} 着陸時刻`);
    if (b.releaseAlt != null && a.releaseAlt == null) cleared.push(`${who} 離脱高度`);
    if (b.releaseDist != null && a.releaseDist == null) cleared.push(`${who} 離脱距離`);
  }

  const key = [ip, before.length, after.length, removed.length, added.length, cleared.join("/")].join("|");
  const now = Date.now();
  if (key === lastSetKey && now - lastSetAtMs < SET_LOG_COALESCE_MS) return;
  lastSetKey = key;
  lastSetAtMs = now;

  const parts = [`[flight-log] set from ${ip}: ${before.length}件 -> ${after.length}件`];
  if (added.length > 0) parts.push(`追加${added.length}`);
  if (removed.length > 0) {
    parts.push(`★削除${removed.length}: ` +
      removed.map((f) => `${f.registration || f.deviceId} ${f.takeoffTime}`).join(", "));
  }
  if (cleared.length > 0) parts.push(`★値が消えた: ${cleared.join(", ")}`);
  console.log(parts.join(" / "));
}

// GET /api/flight-log — 現在の飛行記録と、機体ごとの状態
export async function GET() {
  return NextResponse.json({ entries: getFlightLog(), phases: getPhases() });
}

// POST /api/flight-log — ブラウザからの手動編集
export async function POST(request: Request) {
  const body = await request.json();
  const { action } = body;
  const ip = clientIpFromRequest(request) || "不明";

  switch (action) {
    case "set": {
      const entries: FlightLogEntry[] = body.entries || [];
      const before = getFlightLog();
      setFlightLog(entries);
      const after = getFlightLog();
      logFlightLogSet(ip, before, after);
      return NextResponse.json({ ok: true, count: after.length });
    }

    case "reset": {
      const before = getFlightLog();
      // 全消去は滅多に起きず、起きたら影響が大きい。まとめずに必ず出す
      console.log(`[flight-log] ★reset from ${ip}: ${before.length}件をすべて消去`);
      resetFlightLog();
      return NextResponse.json({ ok: true });
    }

    default:
      return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
  }
}
