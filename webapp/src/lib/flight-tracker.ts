/**
 * 離着陸・離脱の検知（サーバ側・揮発メモリ）
 *
 * これまではブラウザ側で検知していたため、
 *   - ページを開いていない間は一切記録されない
 *   - 複数のブラウザがそれぞれ計算し、共有ログを上書きし合う
 *   - ブラウザを開き直すたびに、上空の機体が「離陸」として記録される
 * という問題があった。webapp のプロセス内で MQTT を購読して検知し、結果を
 * メモリ上に保持する。OverlayFS を有効にすると SD カードへ書けないため、
 * ディスクには一切書かない。
 */
import { readFile } from "fs/promises";
import mqtt from "mqtt";
import type { AircraftDatabase, AircraftPosition } from "@/lib/types";

const FEELDSCOPE_DIR = process.env.FEELDSCOPE_DIR || "/home/pi/FEELDSCOPE";
const AIRFIELD_CONFIG_PATH =
  process.env.FEELDSCOPE_AIRFIELD_CONFIG || `${FEELDSCOPE_DIR}/airfield-config.json`;
const AIRCRAFT_DB_PATH =
  process.env.FEELDSCOPE_AIRCRAFT_DB || `${FEELDSCOPE_DIR}/aircraft-db.json`;
const MQTT_URL = process.env.FEELDSCOPE_MQTT_URL || "mqtt://localhost:1883";
const CONFIG_REFRESH_MS = 30_000;

// ── 閾値 ──────────────────────────────────────────────────────────────────
const TAKEOFF_SPEED_MS = 30 / 3.6;    // 30 km/h を超えたら滑走開始
const LANDING_SPEED_MS = 10 / 3.6;    // 10 km/h を下回ったら停止
/** 接地後の滑走・地上走行とみなす速度。止まるまで受信できるとは限らない */
const LANDING_ROLL_SPEED_MS = 50 / 3.6;
/** 低空・低速がこれだけ続いたら接地とみなす */
const LANDING_ROLL_CONFIRM_SEC = 8;
/** 「確かに離陸した」とみなす高度。高くしすぎると低い曳航で着陸を取りこぼす */
const AIRBORNE_CONFIRM_AGL_M = 500 * 0.3048;
/** 初めて受信した機体を「地上にいる」と判断できる高度 */
const ON_GROUND_AGL_M = 50;

// ── 受信が途切れたときの後始末 ──────────────────────────────────────────
/** 最後の位置がこれだけ古くなったら、降りたのかどうかを判断する */
const SIGNAL_LOST_SEC = 120;
/** 受信が途切れた位置がこれより低ければ、そこで降りたとみなす */
const SIGNAL_LOST_AGL_M = 100;
/** 受信が途切れた位置が飛行場からこれ以内なら、その飛行場に降りたとみなす */
const SIGNAL_LOST_NEAR_FIELD_M = 3000;
/** 受信が途切れた機体を見に行く間隔 */
const SWEEP_INTERVAL_MS = 20_000;

/** 離脱判定を始める最低高度 */
const RELEASE_MIN_AGL_M = 150;
/** 曳航機: 最高高度からこれだけ下がったら離脱済みとみなす */
const TOW_RELEASE_ALT_DROP_M = 50;
const TOW_RELEASE_MIN_AGL_M = 300;
/** 離脱とみなすには、離陸後これだけ高度を稼いでいること */
const RELEASE_MIN_CLIMB_GAIN_M = 100;
/** 上昇中とみなす上昇率 */
const CLIMB_ACTIVE_MS = 1.5;
/** 上昇が止まったとみなす上昇率 */
const CLIMB_STOPPED_MS = 0;
/** 離脱時の減速を見る時間窓 */
const RELEASE_WINDOW_SEC = 6;
/** 時間窓内にこれだけ減速したら離脱（索が外れ、機体が自分の速度まで落ちる） */
const RELEASE_SPEED_DROP_MS = 5;
/** 離陸からこの時間を過ぎたら、もう曳航・ウィンチではない */
const RELEASE_MAX_AGE_SEC = 20 * 60;

// ── 復号エラーの位置を弾く（送信側 ogn-mqtt.py と同じ考え方） ────────────
const MAX_ALTITUDE_M = 15000;
const MIN_ALTITUDE_M = -500;
const MAX_GROUND_SPEED_MS = 150;
const MAX_VERTICAL_SPEED_MS = 40;
/** 直前の位置がこれより古いと、動いたのか壊れたのか判断できないので通す */
const JUMP_MAX_GAP_SEC = 300;
/** 連続でこれだけ弾いたら基準側が怪しいので取り直す */
const MAX_CONSECUTIVE_REJECTS = 5;

export type FlightPhase = "ground" | "airborne" | "released";

export interface FlightLogEntry {
  id: string;
  registration: string;
  deviceId: string;
  takeoffTime: string;
  /**
   * HH:MM。null は「飛行中」。"" は「着陸したが時刻を取れなかった」空欄で、
   * 画面では手入力できる空のマスになる。
   */
  landingTime: string | null;
  releaseAlt: number | null;
  releaseDist: number | null;
}

interface Sample {
  timeMs: number;
  speedMs: number;
  climbMs: number;
}

interface LastFix {
  lat: number;
  lon: number;
  altM: number;
  timeMs: number;
}

interface TrackingState {
  phase: FlightPhase;
  /** 直近で妥当と判断した位置。復号エラーの飛躍を弾く基準 */
  lastFix: LastFix | null;
  /** ありえない位置を連続で弾いた回数 */
  rejects: number;
  /** 離陸を実際に観測できた飛行の id。観測できていなければ null */
  flightId: string | null;
  takeoffMs: number | null;
  maxAltAgl: number;
  takeoffAgl: number;
  wasHigh: boolean;
  /** 低空・低速が続き始めた時刻。接地の判断に使う */
  lowSlowSinceMs: number | null;
  recent: Sample[];
}

interface Airfield {
  name: string;
  latitude: number;
  longitude: number;
  elevation_m: number;
}

const DEFAULT_AIRFIELD: Airfield = {
  name: "関宿滑空場",
  latitude: 36.0095,
  longitude: 139.818,
  elevation_m: 10,
};

// ── 状態（プロセスのメモリ上のみ。ディスクには書かない） ────────────────
// Next.js は instrumentation.ts と API ルートを別々のモジュールグラフで読む
// ため、モジュール変数に置くと状態が2つできる（検知する側と読み出す側が別に
// なってしまう）。globalThis に1つだけ持たせて共有する。
interface TrackerState {
  flights: FlightLogEntry[];
  tracking: Map<string, TrackingState>;
  airfield: Airfield;
  aircraftDb: AircraftDatabase;
  lastResetDay: string;
  started: boolean;
  seq: number;
}

const STATE_KEY = Symbol.for("feeldscope.flightTracker");

function S(): TrackerState {
  const g = globalThis as unknown as Record<symbol, TrackerState | undefined>;
  let s = g[STATE_KEY];
  if (!s) {
    s = {
      flights: [],
      tracking: new Map(),
      airfield: DEFAULT_AIRFIELD,
      aircraftDb: {},
      lastResetDay: "",
      started: false,
      seq: 0,
    };
    g[STATE_KEY] = s;
  }
  return s;
}

// ── 時刻（日本の滑空場で使うので JST 固定。端末の TZ 設定に依存させない） ──
const JST_OFFSET_MS = 9 * 3600_000;

/** HH:MM（JST）。既定は今、受信が途切れた場合はその位置の時刻を渡す */
function clockStr(atMs: number = Date.now()): string {
  const d = new Date(atMs + JST_OFFSET_MS);
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}

/** 05:00 JST 始まりの「ログブック日」 */
function logbookDay(): string {
  return new Date(Date.now() + JST_OFFSET_MS - 5 * 3600_000).toISOString().slice(0, 10);
}

function checkDailyReset(): void {
  const s = S();
  const day = logbookDay();
  if (s.lastResetDay === "") {
    s.lastResetDay = day;
    return;
  }
  if (s.lastResetDay !== day) {
    s.flights = [];
    s.tracking.clear();
    s.lastResetDay = day;
  }
}

function haversineM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/**
 * この機体の「飛行中」のまま残っている記録を閉じる。
 * time に "" を渡すと着陸時刻は空欄になる（何時に降りたか分からない場合）。
 */
function closeOpenFlights(deviceId: string, time: string, exceptId?: string): void {
  const s = S();
  let changed = false;
  const next = s.flights.map((f) => {
    if (f.deviceId !== deviceId || f.landingTime !== null || f.id === exceptId) return f;
    changed = true;
    return { ...f, landingTime: time };
  });
  if (changed) s.flights = next;
}

/** 着陸を記録する。追っていた飛行に時刻を入れ、取り残しがあれば空欄で閉じる */
function recordLanding(deviceId: string, tr: TrackingState, time: string): void {
  const s = S();
  const id = tr.flightId;
  if (id) {
    s.flights = s.flights.map((f) =>
      f.id === id && f.landingTime === null ? { ...f, landingTime: time } : f);
  }
  closeOpenFlights(deviceId, "");
}

/** 着陸後（地上）の状態に戻す */
function toGround(tr: TrackingState, agl: number): void {
  tr.phase = "ground";
  tr.flightId = null;
  tr.takeoffMs = null;
  tr.maxAltAgl = agl;
  tr.takeoffAgl = agl;
  tr.wasHigh = false;
  tr.lowSlowSinceMs = null;
}

/**
 * 同じ機体の記録がその後に続いていれば、前の飛行はもう終わっている。
 * 着陸を取りこぼしても「飛行中」のまま残らないよう、着陸時刻を空欄にして閉じる
 * （何時に降りたかは分からないので、手で入れてもらう）。
 */
function normalizeFlights(): void {
  const s = S();
  const lastIndex = new Map<string, number>();
  s.flights.forEach((f, i) => lastIndex.set(f.deviceId, i));
  let changed = false;
  const next = s.flights.map((f, i) => {
    if (f.landingTime === null && (lastIndex.get(f.deviceId) ?? i) > i) {
      changed = true;
      return { ...f, landingTime: "" };
    }
    return f;
  });
  if (changed) s.flights = next;
}

/**
 * 受信が途切れた機体の後始末。着陸は「止まったところを受信できたとき」しか
 * 分からないが、実際には接地の直後に受信が切れることがある（滑走路上は電波が
 * 届きにくい、駐機して電源を切る、など）。最後に受信できた位置が飛行場の
 * すぐそばの低空なら、そこで降りたものとして着陸時刻を入れる。
 *
 * 逆に、上空で受信が途切れただけなら何もしない。遠くを長時間飛び続けて
 * 受信圏外にいるだけかもしれず、勝手に着陸にしてはいけない。
 */
function sweepStaleTracks(): void {
  const s = S();
  const nowMs = Date.now();
  for (const [deviceId, tr] of s.tracking) {
    const fix = tr.lastFix;
    if (!fix) continue;
    const silenceSec = (nowMs - fix.timeMs) / 1000;
    if (silenceSec < SIGNAL_LOST_SEC) continue;

    if (tr.phase !== "ground" && (tr.wasHigh || tr.takeoffMs !== null)) {
      const aglAtFix = fix.altM - s.airfield.elevation_m;
      const distM = haversineM(
        s.airfield.latitude, s.airfield.longitude, fix.lat, fix.lon);
      if (aglAtFix < SIGNAL_LOST_AGL_M && distM < SIGNAL_LOST_NEAR_FIELD_M) {
        recordLanding(deviceId, tr, clockStr(fix.timeMs));
        toGround(tr, aglAtFix);
      }
    }
  }
}

function isTowPlane(
  gliderType?: string,
  registration?: string,
  aircraftType?: string,
  dbType?: string,
): boolean {
  if (dbType === "tow") return true;
  if (dbType && dbType !== "tow") return false;
  if (aircraftType === "Tow Plane") return true;
  const t = (gliderType || "").toLowerCase();
  if (["hk-36", "husky", "pawnee", "piper", "robin", "tow"].some((k) => t.includes(k))) return true;
  return (registration || "").toUpperCase().startsWith("JA4");
}

async function loadConfig(): Promise<void> {
  const s = S();
  try {
    const parsed = JSON.parse(await readFile(AIRFIELD_CONFIG_PATH, "utf-8"));
    s.airfield = {
      name: typeof parsed.name === "string" ? parsed.name : DEFAULT_AIRFIELD.name,
      latitude: typeof parsed.latitude === "number" ? parsed.latitude : DEFAULT_AIRFIELD.latitude,
      longitude:
        typeof parsed.longitude === "number" ? parsed.longitude : DEFAULT_AIRFIELD.longitude,
      elevation_m:
        typeof parsed.elevation_m === "number" ? parsed.elevation_m : DEFAULT_AIRFIELD.elevation_m,
    };
  } catch { /* 既定値のまま */ }
  try {
    s.aircraftDb = JSON.parse(await readFile(AIRCRAFT_DB_PATH, "utf-8"));
  } catch { /* 空のまま */ }
}

/** 時間窓内の最大速度（そこからどれだけ減速したかを測る基準） */
function maxSpeedInWindow(recent: Sample[], nowMs: number): number {
  let max = 0;
  for (const s of recent) {
    if (nowMs - s.timeMs <= RELEASE_WINDOW_SEC * 1000) max = Math.max(max, s.speedMs);
  }
  return max;
}

/** 時間窓内に「しっかり上昇していた」か */
function wasClimbingInWindow(recent: Sample[], nowMs: number): boolean {
  return recent.some(
    (x) => nowMs - x.timeMs <= RELEASE_WINDOW_SEC * 1000 && x.climbMs >= CLIMB_ACTIVE_MS,
  );
}

/**
 * 1機ぶんの位置を処理する。
 *
 * 離陸は「地上にいたことを確認できた機体」にしか記録しない。受信を始めた
 * 時点で既に飛んでいる機体は、飛行中として扱うだけで飛行を作らない
 * （作ると、サービスを起動し直すたびに偽の離陸が並ぶ）。
 */
export function handlePosition(deviceId: string, pos: AircraftPosition): void {
  if (pos.adsb) return;
  if (!Number.isFinite(pos.latitude) || !Number.isFinite(pos.longitude)) return;
  if (!Number.isFinite(pos.altitude_m) || !Number.isFinite(pos.ground_speed_ms)) return;

  checkDailyReset();
  const s = S();

  const nowMs = Date.now();
  const rec = s.aircraftDb[deviceId];
  const registration =
    rec?.registration || pos.glider_id || rec?.competition_id || pos.competition_id || deviceId;
  const tow = isTowPlane(
    rec?.glider_type || pos.glider_type,
    registration,
    pos.aircraft_type,
    rec?.aircraft_type,
  );

  // 復号エラーで壊れた位置は、飛行記録も航跡も壊すので採用しない
  if (Math.abs(pos.latitude) > 90 || Math.abs(pos.longitude) > 180) return;
  if (pos.altitude_m < MIN_ALTITUDE_M || pos.altitude_m > MAX_ALTITUDE_M) return;

  const agl = pos.altitude_m - s.airfield.elevation_m;
  const speedMs = pos.ground_speed_ms;
  const climbMs = Number.isFinite(pos.climb_rate_ms) ? pos.climb_rate_ms : 0;

  let tr = s.tracking.get(deviceId);
  if (!tr) {
    // 初めて見る機体。地上にいると確認できたときだけ "ground" から始める。
    const onGround = agl < ON_GROUND_AGL_M && speedMs < TAKEOFF_SPEED_MS;
    tr = {
      phase: onGround ? "ground" : "airborne",
      lastFix: null,
      rejects: 0,
      flightId: null,
      takeoffMs: null,
      maxAltAgl: agl,
      takeoffAgl: agl,
      wasHigh: agl > AIRBORNE_CONFIRM_AGL_M,
      lowSlowSinceMs: null,
      recent: [],
    };
    s.tracking.set(deviceId, tr);
  }

  // 直前の位置から見て、ありえない速度で動いていたら復号エラーとみなす
  const fix = tr.lastFix;
  if (fix) {
    const dtSec = (nowMs - fix.timeMs) / 1000;
    if (dtSec > 0 && dtSec <= JUMP_MAX_GAP_SEC) {
      const distM = haversineM(fix.lat, fix.lon, pos.latitude, pos.longitude);
      const bad =
        distM / dtSec > MAX_GROUND_SPEED_MS ||
        Math.abs(pos.altitude_m - fix.altM) / dtSec > MAX_VERTICAL_SPEED_MS;
      if (bad && tr.rejects < MAX_CONSECUTIVE_REJECTS) {
        tr.rejects += 1;
        return;
      }
    }
  }
  tr.rejects = 0;
  tr.lastFix = { lat: pos.latitude, lon: pos.longitude, altM: pos.altitude_m, timeMs: nowMs };

  tr.recent.push({ timeMs: nowMs, speedMs, climbMs });
  const windowStart = nowMs - RELEASE_WINDOW_SEC * 1000;
  while (tr.recent.length > 0 && tr.recent[0].timeMs < windowStart) tr.recent.shift();

  // ── 離陸 ──
  if (tr.phase === "ground") {
    // 地上にいるのに「飛行中」の記録が残っているなら、それはもう終わった飛行。
    // 着陸を取りこぼしたか、その飛行の途中でサービスが起動し直されたかなので、
    // 着陸時刻を空欄にして閉じる（時刻は分からないので手で入れてもらう）。
    if (agl < ON_GROUND_AGL_M && speedMs < TAKEOFF_SPEED_MS) {
      closeOpenFlights(deviceId, "");
    }
    if (speedMs > TAKEOFF_SPEED_MS) {
      const entry: FlightLogEntry = {
        id: `f${nowMs.toString(36)}${(s.seq++).toString(36)}`,
        registration,
        deviceId,
        takeoffTime: clockStr(),
        landingTime: null,
        releaseAlt: null,
        releaseDist: null,
      };
      s.flights = [...s.flights, entry];
      // 同じ機体が離陸した以上、前の飛行はもう終わっている
      closeOpenFlights(deviceId, "", entry.id);
      tr.phase = "airborne";
      tr.flightId = entry.id;
      tr.takeoffMs = nowMs;
      tr.maxAltAgl = agl;
      tr.takeoffAgl = agl;
      tr.wasHigh = agl > AIRBORNE_CONFIRM_AGL_M;
      tr.lowSlowSinceMs = null;
    }
    return;
  }

  if (agl > tr.maxAltAgl) tr.maxAltAgl = agl;
  if (agl > AIRBORNE_CONFIRM_AGL_M) tr.wasHigh = true;

  // サーバを再起動した直後は、飛行中の機体と記録の対応が切れている
  // （記録はブラウザの控えから戻される）。飛行中なら未着陸の記録を引き受けて、
  // その飛行の着陸がちゃんと入るようにする。追っていた記録が消された・
  // 入れ替わった場合も、ここで引き受け直す。
  if (tr.flightId && !s.flights.some((f) => f.id === tr.flightId)) tr.flightId = null;
  if (!tr.flightId) {
    const open = [...s.flights].reverse().find(
      (f) => f.deviceId === deviceId && f.landingTime === null);
    if (open) {
      tr.flightId = open.id;
      if (tr.phase === "released" || open.releaseAlt != null) tr.phase = "released";
      tr.wasHigh = true;
    }
  }

  const flight = tr.flightId ? s.flights.find((f) => f.id === tr.flightId) : undefined;

  // ── 離脱 ──
  // 離陸を観測できた飛行にだけ付ける。受信開始時から飛んでいた機体に付けても
  // どの飛行のものか分からず、上空のサーマル旋回を拾ってしまう。
  if (
    tr.phase === "airborne" &&
    flight &&
    agl > RELEASE_MIN_AGL_M &&
    tr.takeoffMs !== null &&
    nowMs - tr.takeoffMs < RELEASE_MAX_AGE_SEC * 1000
  ) {
    let released = false;

    if (tow && agl > TOW_RELEASE_MIN_AGL_M) {
      // 曳航機は離脱後に降下していく。最高高度からの下がりが確実な合図。
      if (tr.maxAltAgl - agl > TOW_RELEASE_ALT_DROP_M) released = true;
    } else if (!tow && tr.maxAltAgl - tr.takeoffAgl >= RELEASE_MIN_CLIMB_GAIN_M) {
      // 曳航でもウィンチでも、離脱は「続いていた上昇の終わり」に現れる。
      // 索が外れた機体は引かれなくなって自分の速度まで落ちるので、
      // 「上昇が止まった」ことと「はっきり減速した」ことの両方を見る。
      // サーマルから抜けるときは加速するので、この条件には掛からない。
      const dropMs = maxSpeedInWindow(tr.recent, nowMs) - speedMs;
      if (
        climbMs <= CLIMB_STOPPED_MS &&
        wasClimbingInWindow(tr.recent, nowMs) &&
        dropMs >= RELEASE_SPEED_DROP_MS
      ) {
        released = true;
      }
    }

    if (released) {
      const distM = haversineM(
        s.airfield.latitude, s.airfield.longitude, pos.latitude, pos.longitude);
      tr.phase = "released";
      const alt = Math.round(tr.maxAltAgl);
      s.flights = s.flights.map((f) =>
        f.id === flight.id ? { ...f, releaseAlt: alt, releaseDist: distM } : f);
    }
  }

  // ── 着陸 ──
  // 止まったところまで受信できるとは限らない。滑走路上は電波が届きにくく、
  // 曳航機は止まらずに次の索へ戻ることもある。「止まった」ことに加えて、
  // 「低空・低速が続いた」ことでも接地とみなす。進入中の機体は低空にいる
  // 時間が短く、対地速度も滑走中より速いので、この条件には掛からない。
  if (agl < ON_GROUND_AGL_M && speedMs < LANDING_ROLL_SPEED_MS) {
    if (tr.lowSlowSinceMs === null) tr.lowSlowSinceMs = nowMs;
  } else {
    tr.lowSlowSinceMs = null;
  }
  const stopped = agl < AIRBORNE_CONFIRM_AGL_M && speedMs < LANDING_SPEED_MS;
  const rolledOut =
    tr.lowSlowSinceMs !== null &&
    nowMs - tr.lowSlowSinceMs >= LANDING_ROLL_CONFIRM_SEC * 1000;

  // 高く上がらなかった飛行（低い場周、離陸中止）でも、離陸を観測できていれば
  // その飛行の終わりとして着陸を記録する。
  if ((tr.wasHigh || tr.takeoffMs !== null) && (stopped || rolledOut)) {
    recordLanding(deviceId, tr, clockStr());
    toGround(tr, agl);
  }
}

// ── 外部インターフェース ──────────────────────────────────────────────────

export function getFlightLog(): FlightLogEntry[] {
  checkDailyReset();
  normalizeFlights();
  return S().flights;
}

/** 機体ごとの現在の状態。地図の着陸進入表示に使う */
export function getPhases(): Record<string, FlightPhase> {
  const out: Record<string, FlightPhase> = {};
  for (const [id, tr] of S().tracking) out[id] = tr.phase;
  return out;
}

/** ブラウザ側で手動編集した結果を反映する */
export function setFlightLog(entries: FlightLogEntry[]): void {
  checkDailyReset();
  const s = S();
  s.flights = entries.map((e, i) => ({
    ...e,
    id: e.id || `m${Date.now().toString(36)}${i.toString(36)}`,
  }));
  normalizeFlights();
  // 消された飛行を追い続けないよう、対応を切る
  const ids = new Set(s.flights.map((f) => f.id));
  for (const tr of s.tracking.values()) {
    if (tr.flightId && !ids.has(tr.flightId)) tr.flightId = null;
  }
}

export function resetFlightLog(): void {
  const s = S();
  s.flights = [];
  s.tracking.clear();
  s.lastResetDay = logbookDay();
}

/** MQTT を購読して検知を開始する。何度呼んでも購読は1つだけ */
export function startFlightTracker(): void {
  const s = S();
  if (s.started) return;
  s.started = true;
  s.lastResetDay = logbookDay();

  void loadConfig();
  setInterval(() => void loadConfig(), CONFIG_REFRESH_MS);
  // 受信が途切れたまま「飛行中」で残る記録を拾う
  setInterval(() => sweepStaleTracks(), SWEEP_INTERVAL_MS);

  const client = mqtt.connect(MQTT_URL, {
    clientId: `feeldscope-flight-tracker-${Math.random().toString(36).slice(2, 8)}`,
    reconnectPeriod: 5000,
  });

  client.on("connect", () => {
    client.subscribe("ogn/+/aircraft/+/position");
    console.log("[flight-tracker] connected to", MQTT_URL);
  });
  client.on("error", (err) => console.warn("[flight-tracker] mqtt error:", err.message));
  client.on("message", (topic, payload) => {
    const parts = topic.split("/");
    if (parts.length !== 5 || parts[4] !== "position") return;
    try {
      handlePosition(parts[3], JSON.parse(payload.toString()) as AircraftPosition);
    } catch { /* 壊れたペイロードは捨てる */ }
  });
}
