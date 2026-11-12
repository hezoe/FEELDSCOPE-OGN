import { NextResponse } from "next/server";
import { mkdir, readdir, unlink, writeFile } from "fs/promises";
import { clientIpFromRequest, getAuthContext, isAuthorizedToMutate } from "@/lib/auth";
import { rateOk } from "@/lib/rate-limit";
import {
  getFlightLog,
  getLaunching,
  getPhases,
  resetFlightLog,
  setFlightLog,
  startFlightTracker,
  type FlightLogEntry,
} from "@/lib/flight-tracker";

// 検知は instrumentation.ts から起動されるが、そこが走らない構成でも
// 動くよう、このルートが読み込まれた時点でも起動しておく（二重起動はしない）。
startFlightTracker();

// ── R-085 (v1.4.47): 無認証の編集 API の守り ────────────────────────────────
// 飛行ログの編集(set)はクラブのメンバーが場内 LAN から行うので、これまでどおり認証は
// 求めない(浩さんの判断・2026-11-11)。代わりに「壊れ方が大きい操作」だけを止める:
//   - 全消去(reset)は管理者ログイン(またはオペレーター)が必要。画面からは使っていない
//   - 1回の set で 4 行以上が消える差し替えは管理者ログインが必要(行の削除は画面では
//     1 行ずつなので、通常の編集では起きない。起きるのは古い一覧の押し付けか悪意ある操作)
//   - 本文 256KB・2,000 行まで、送信元ごとに 1 分 120 回まで(時刻欄は 1 文字ごとに set を呼ぶ)
//   - 項目の型と長さを確かめる(でたらめな中身をメモリに積ませない)
//   - 行が消える set と reset の直前に、消える前の一覧を /tmp に控える(当日中の復元用)
const MAX_BODY_BYTES = 256 * 1024;
const MAX_ENTRIES = 2000;
const MAX_REMOVED_WITHOUT_LOGIN = 3;
const RATE_LIMIT = 120;
const RATE_WINDOW_MS = 60_000;
const MAX_STR = 64;
const SNAPSHOT_DIR = process.env.FEELDSCOPE_FLIGHTLOG_SNAPSHOT_DIR || "/tmp/feeldscope-flightlog";
const SNAPSHOT_KEEP = 30;

function isValidEntry(e: unknown): e is FlightLogEntry {
  if (!e || typeof e !== "object") return false;
  const o = e as Record<string, unknown>;
  const str = (v: unknown) => typeof v === "string" && v.length <= MAX_STR;
  const numOrNull = (v: unknown) => v == null || (typeof v === "number" && Number.isFinite(v));
  // id は空でもよい(サーバが採番する)。文字列の項目は長さを抑える
  if (o.id != null && !str(o.id)) return false;
  if (!str(o.registration ?? "") || !str(o.deviceId ?? "") || !str(o.takeoffTime ?? "")) return false;
  if (o.landingTime != null && !str(o.landingTime)) return false;
  if (!numOrNull(o.releaseAlt) || !numOrNull(o.releaseDist)) return false;
  return true;
}

/** 消える前の一覧を控える。失敗しても本処理は止めない */
async function snapshotFlightLog(reason: string, ip: string, entries: FlightLogEntry[]): Promise<void> {
  try {
    await mkdir(SNAPSHOT_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..*$/, "");
    const file = `${SNAPSHOT_DIR}/${stamp}-${reason}.json`;
    await writeFile(file, JSON.stringify({ at: new Date().toISOString(), reason, from: ip, entries }, null, 1));
    const files = (await readdir(SNAPSHOT_DIR)).filter((f) => f.endsWith(".json")).sort();
    for (const old of files.slice(0, Math.max(0, files.length - SNAPSHOT_KEEP))) {
      await unlink(`${SNAPSHOT_DIR}/${old}`).catch(() => {});
    }
  } catch (e) {
    console.warn(`[flight-log] snapshot failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/**
 * 飛行ログを書き換えた記録を journal に残す。
 *
 * なぜ要るか:
 * 飛行ログの差し替え(set)は無認証で誰でも呼べる。場内LANでの運用を前提にした設計なので
 * 認証は付けないが、記録が消えたり書き換わったりしたときに「いつ・どこから・何が起きたか」を
 * 後から追えるようにしておく。
 * 2026-09-20 に、手編集が受信側の検知結果を上書きして離脱高度が1件消えたが、
 * 痕跡が無いため原因の特定に journal との突き合わせが必要だった。
 *
 * 地図の時刻欄は1文字打つごとに set を呼ぶので、そのまま出すと journal が
 * 埋まる。件数と破壊的変更の有無が同じ行は短時間まとめて1行にする。
 */
let lastSetKey = "";
let lastSetAtMs = 0;
const SET_LOG_COALESCE_MS = 5000;

function diffFlightLog(before: FlightLogEntry[], after: FlightLogEntry[]) {
  const beforeById = new Map(before.map((f) => [f.id, f]));
  const afterById = new Map(after.map((f) => [f.id, f]));
  const removed = before.filter((f) => !afterById.has(f.id));
  const added = after.filter((f) => !beforeById.has(f.id));
  return { beforeById, removed, added };
}

function logFlightLogSet(ip: string, before: FlightLogEntry[], after: FlightLogEntry[]): void {
  const { beforeById, removed, added } = diffFlightLog(before, after);

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

// GET /api/flight-log — 現在の飛行記録と、機体ごとの状態・発航中(曳航中・ウィンチ発航中)の機体
export async function GET() {
  return NextResponse.json({ entries: getFlightLog(), phases: getPhases(), launching: getLaunching() });
}

// POST /api/flight-log — ブラウザからの手動編集
export async function POST(request: Request) {
  const ip = clientIpFromRequest(request) || "不明";

  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "送信が大きすぎます" }, { status: 413 });
  }
  if (!rateOk(`flight-log:${ip}`, RATE_LIMIT, RATE_WINDOW_MS)) {
    return NextResponse.json({ error: "操作が多すぎます。少し待ってからやり直してください" }, { status: 429 });
  }

  let body: { action?: unknown; entries?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "本文を読めません" }, { status: 400 });
  }
  const { action } = body;

  switch (action) {
    case "set": {
      const raw = body.entries ?? [];
      if (!Array.isArray(raw) || raw.length > MAX_ENTRIES || !raw.every(isValidEntry)) {
        console.log(`[flight-log] ★set from ${ip}: 中身が不正なため拒否`);
        return NextResponse.json({ error: "飛行記録の形式が正しくありません" }, { status: 400 });
      }
      const entries: FlightLogEntry[] = raw;
      const before = getFlightLog();
      const { removed } = diffFlightLog(before, entries);
      if (removed.length > MAX_REMOVED_WITHOUT_LOGIN) {
        const ctx = await getAuthContext(request);
        if (!isAuthorizedToMutate(ctx)) {
          console.log(`[flight-log] ★set from ${ip}: ${removed.length}行の一括削除を拒否(ログインなし)`);
          return NextResponse.json(
            { error: `${removed.length} 行をまとめて消す変更は管理者のログインが必要です(1 行ずつの削除はログイン不要)`, need_login: true },
            { status: 403 },
          );
        }
      }
      if (removed.length > 0) await snapshotFlightLog("set", ip, before);
      setFlightLog(entries);
      const after = getFlightLog();
      logFlightLogSet(ip, before, after);
      return NextResponse.json({ ok: true, count: after.length });
    }

    case "reset": {
      const ctx = await getAuthContext(request);
      if (!isAuthorizedToMutate(ctx)) {
        console.log(`[flight-log] ★reset from ${ip}: 拒否(ログインなし)`);
        return NextResponse.json({ error: "全消去は管理者のログインが必要です", need_login: true }, { status: 403 });
      }
      const before = getFlightLog();
      // 全消去は滅多に起きず、起きたら影響が大きい。まとめずに必ず出す
      console.log(`[flight-log] ★reset from ${ip}: ${before.length}件をすべて消去`);
      if (before.length > 0) await snapshotFlightLog("reset", ip, before);
      resetFlightLog();
      return NextResponse.json({ ok: true });
    }

    default:
      return NextResponse.json({ error: `Unknown action: ${String(action)}` }, { status: 400 });
  }
}
