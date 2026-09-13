// flight-tracker.ts の本物を、記録した MQTT の位置でそのまま動かす再現ハーネス。
// 時計（Date.now）とタイマー（setInterval）は記録の時刻で進めるので、
// 1日ぶんが数秒で終わり、実運用と同じ判定になる。MQTT はスタブ。
//
//   node tools/replay-tracker.mjs <flight-tracker.ts> <aircraft-db.json> <capture.jsonl...> [--json out.json] [--log]
//
// Node 22.18+ / 24 の型ストリップで .ts をそのまま読む（ビルド不要）。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const args = process.argv.slice(2);
const jsonOut = args.includes("--json") ? args.splice(args.indexOf("--json"), 2)[1] : null;
const showLog = args.includes("--log") ? (args.splice(args.indexOf("--log"), 1), true) : false;
const [trackerSrc, dbPath, ...captures] = args;
if (!trackerSrc || !dbPath || captures.length === 0) {
  console.error("usage: node replay-tracker.mjs <flight-tracker.ts> <aircraft-db.json> <capture...> [--json out] [--log]");
  process.exit(2);
}

// たきかわ滑空場（sim.py / lib_legs.py と同じ値）
const AIRFIELD = { name: "たきかわ", latitude: 43.549417, longitude: 141.89415, elevation_m: 23 };
// ogn-mqtt は2秒ごとに ogn-decode を読むので、受信から配信までの遅れを足す
const DELIVERY_DELAY_MS = 2000;

// ── 作業ディレクトリ（mqtt のスタブと設定ファイル） ──
const work = fs.mkdtempSync(path.join(process.env.REPLAY_TMP || os.tmpdir(), "replay-"));
const stubDir = path.join(work, "node_modules", "mqtt");
fs.mkdirSync(stubDir, { recursive: true });
fs.writeFileSync(path.join(work, "package.json"), JSON.stringify({ type: "module" }));
fs.writeFileSync(path.join(stubDir, "package.json"), JSON.stringify({ name: "mqtt", type: "module", main: "index.js" }));
fs.writeFileSync(path.join(stubDir, "index.js"),
  "export default { connect() { return { on() {}, subscribe() {} }; } };\n");
fs.copyFileSync(trackerSrc, path.join(work, "flight-tracker.ts"));
let db = JSON.parse(fs.readFileSync(dbPath, "utf8"));
if (db && db.aircraft) db = db.aircraft;
fs.writeFileSync(path.join(work, "aircraft-db.json"), JSON.stringify(db));
fs.writeFileSync(path.join(work, "airfield-config.json"), JSON.stringify(AIRFIELD));
process.env.FEELDSCOPE_AIRFIELD_CONFIG = path.join(work, "airfield-config.json");
process.env.FEELDSCOPE_AIRCRAFT_DB = path.join(work, "aircraft-db.json");

// ── 記録を読む（時刻順・機体と時刻で重複除去） ──
const points = [];
const seen = new Set();
for (const file of captures) {
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const i = line.indexOf(" {");
    if (i < 0) continue;
    const dev = line.slice(0, i).split("/")[3];
    let d;
    try { d = JSON.parse(line.slice(i + 1)); } catch { continue; }
    const key = `${dev}@${d.timestamp_epoch}`;
    if (seen.has(key)) continue;
    seen.add(key);
    points.push({ t: d.timestamp_epoch * 1000 + DELIVERY_DELAY_MS, dev, d });
  }
}
points.sort((a, b) => a.t - b.t);
if (points.length === 0) { console.error("no points"); process.exit(1); }

// ── 時計とタイマーを記録の時刻にする ──
let now = points[0].t;
Date.now = () => now;
const timers = [];
globalThis.setInterval = (fn, ms) => { timers.push({ fn, ms, next: now + ms }); return timers.length; };
const jst = (ms) => new Date(ms + 9 * 3600_000).toISOString().slice(11, 19);
const logs = [];
const origLog = console.log;
const origWarn = console.warn;
console.log = (...a) => { logs.push(`${jst(now)} ${a.join(" ")}`); if (showLog) origLog(`${jst(now)}`, ...a); };
console.warn = (...a) => { logs.push(`${jst(now)} WARN ${a.join(" ")}`); if (showLog) origWarn(`${jst(now)}`, ...a); };

const T = await import(pathToFileURL(path.join(work, "flight-tracker.ts")).href);
T.startFlightTracker();
await new Promise((r) => setTimeout(r, 200));   // 設定ファイルの非同期読み込みを待つ

function runTimers(until) {
  for (const tm of timers) {
    while (tm.next <= until) { const keep = now; now = tm.next; tm.fn(); now = keep; tm.next += tm.ms; }
  }
}
for (const p of points) {
  runTimers(p.t);
  now = p.t;
  T.handlePosition(p.dev, p.d);
}
runTimers(now + 10 * 60_000);
now += 10 * 60_000;

const entries = T.getFlightLog();
console.log = origLog;
console.log(`${points.length}点 / ${new Set(points.map((p) => p.dev)).size}機 / ${jst(points[0].t)}〜${jst(points[points.length - 1].t)}`);
console.log(`飛行 ${entries.length}便（離脱高度あり ${entries.filter((e) => e.releaseAlt != null).length}便）`);
for (const e of entries) {
  const ra = e.releaseAlt == null ? "-" : `${e.releaseAlt}${e.releaseInferred ? "(補完)" : ""}`;
  const ld = e.landingTime === null ? "FLYING" : (e.landingTime || "(空欄)");
  console.log(`  ${e.takeoffTime}  ${ld.padEnd(6)}  ${(e.registration || e.deviceId).padEnd(10)} ${e.deviceId}  RA=${ra}`);
}
if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify({ entries, logs }, null, 1));
fs.rmSync(work, { recursive: true, force: true });
