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
import { lookupByDeviceId } from "@/lib/aircraft-id";

const FEELDSCOPE_DIR = process.env.FEELDSCOPE_DIR || "/home/pi/FEELDSCOPE";
const AIRFIELD_CONFIG_PATH =
  process.env.FEELDSCOPE_AIRFIELD_CONFIG || `${FEELDSCOPE_DIR}/airfield-config.json`;
const AIRCRAFT_DB_PATH =
  process.env.FEELDSCOPE_AIRCRAFT_DB || `${FEELDSCOPE_DIR}/aircraft-db.json`;
const MQTT_URL = process.env.FEELDSCOPE_MQTT_URL || "mqtt://localhost:1883";
const CONFIG_REFRESH_MS = 30_000;

// ── 閾値 ──────────────────────────────────────────────────────────────────
const TAKEOFF_SPEED_MS = 30 / 3.6;    // 30 km/h を超えたら滑走開始
/**
 * 滑走を離陸として確定する高度。曳航機は着陸後、止まらずに次の索の位置まで
 * 地上を戻る。たきかわ実測(2026-09-12)ではその速度が 30〜42 km/h あり、
 * 離陸判定の 30 km/h を超えて「1分未満の飛行」が次々に記録されていた。
 * 速度だけでは地上滑走と離陸滑走を分けられないので、実際に浮いたことを見る。
 */
const TAKEOFF_CONFIRM_AGL_M = 20;
/**
 * 滑走開始からこれを過ぎても浮かなければ、地上滑走だったとみなす。
 * 実測の離陸は 30 km/h 超えから対地 20m まで、ウィンチ 4〜5秒・曳航 16〜25秒。
 */
const TAKEOFF_CONFIRM_SEC = 60;
const LANDING_SPEED_MS = 10 / 3.6;    // 10 km/h を下回ったら停止
/** 接地後の滑走・地上走行とみなす速度。止まるまで受信できるとは限らない */
const LANDING_ROLL_SPEED_MS = 50 / 3.6;
/** 低空・低速がこれだけ続いたら接地とみなす */
const LANDING_ROLL_CONFIRM_SEC = 8;
/** 「確かに離陸した」とみなす高度。高くしすぎると低い曳航で着陸を取りこぼす */
const AIRBORNE_CONFIRM_AGL_M = 500 * 0.3048;
/** 初めて受信した機体を「地上にいる」と判断できる高度 */
const ON_GROUND_AGL_M = 50;
/**
 * 受信機が出す飛行状態（ogn-decode の位置行3文字目・4bit）の「飛行中」しきい値。
 * 滝川の実測 26.5万点では 1=地上 / 2=飛行中 / 3=飛行中(まれ) しか出ない。
 * 意味が OGN 側に文書化されていないので、判定の主役にはせず裏付けに使う。
 * 値を出さない送信側（シミュレータ・旧版）では従来どおりの判定に落ちる。
 */
const RX_AIRBORNE_MIN_STATE = 2;
/**
 * 受信機の飛行状態を離陸の裏付けに使うときの対地速度の下限。
 * 地上走行中に 1→2 が一瞬ちらつくことがあり（9/12 で6件、9/13 で3件。
 * いずれも対地 1〜3 m/s）、本物の離陸の遷移は 16〜38 m/s だったので
 * ここで切れば取りこぼしなく落とせる。
 */
const RX_TAKEOFF_MIN_SPEED_MS = 8;
/**
 * 離陸は「30 km/h 超」と「対地20m以上」を、それぞれこれだけ続けて受けてから作る。
 * 1点だけの値で作ると、壊れた位置で偽の離陸ができる（たきかわ 2026-09-12 実測:
 * 駐機中の曳航機の電源投入直後に 対地8235m・236 km/h の1点が来て、1分の飛行が記録された）。
 */
const TAKEOFF_CONFIRM_FIXES = 2;
/**
 * 滑走を始めてから離陸を確定するまでに、実際にこれだけ動いていること。
 * 格納庫の近くで FLARM を入れると GPS が不安定で、止まったまま 33 km/h・対地31m の
 * 位置が2回続くことがある（たきかわ 2026-09-13 17:21 実測、位置はほぼ動いていない）。
 * 本物の離陸は 30 km/h 超えから対地20m まで、ウィンチでも 4〜5秒で 70m 以上進む。
 */
const TAKEOFF_CONFIRM_DIST_M = 50;
/**
 * 離陸を観測していない「飛行中」の機体が、地上で止まったままこれだけ続いたら
 * 地上に戻す。戻さないと、その機体の次の離陸を記録できない。
 */
const UNOBSERVED_GROUND_CONFIRM_SEC = 30;

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
/**
 * 最高高度に達したとき**まだはっきり上昇していて**、次の位置までこれより長く受信が
 * 途切れていたら、離脱は途切れているあいだに起きていて観測できていない。受信できた
 * 最高高度は離脱高度ではないので記録しない（たきかわ 2026-09-13 実測: 625m・+3.0 m/s の
 * まま 294秒途切れ、次は 432m で降下中。グライダーは途切れ明けに既に 929m にいた）。
 * 上昇が止まりかけた最高高度（離脱の瞬間）のあとで途切れたのは、降下中に途切れた
 * だけなので記録する（同日 962m・+1.2 m/s のあと 110秒途切れ → グライダーは 963m で離脱）。
 * 3 m/s で上昇していれば、この秒数で 60m の誤差になる。
 */
const RELEASE_UNSEEN_GAP_SEC = 20;
/**
 * 上昇中に途切れ、明けた最初の位置が最高高度だったとき、これ以下の上昇率なら
 * 既にはっきり降下していて、本当の最高点（離脱）は途切れの中にある。
 * 下がり始めたばかり（-1.2 m/s 等）はその位置が離脱の瞬間なので記録する
 * （たきかわ 2026-09-13 実測: 見えていなかった便は -3.6〜-13.2 m/s、見えていた便は -1.2 m/s）。
 */
const RELEASE_UNSEEN_DESCENT_MS = -3;
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

// ── 曳航ペアからの離脱高度の補完 ────────────────────────────────────────
// 曳航機の離脱は「最高高度からの降下」で確実に取れるが、グライダー側は
// 減速を見ているので、上空で受信が飛ぶと取りこぼす。索でつながっていた
// 相手が分かれば、その高度をグライダーへ写せる。
/** ペア候補とみなす離陸時刻の差 */
const TOW_PAIR_TAKEOFF_WINDOW_SEC = 60;
/** 相手の位置がこれより古いと、並んで飛んでいるか判断できない */
const TOW_PAIR_FIX_MAX_AGE_SEC = 15;
/** 曳航中とみなす水平距離（索長 50〜60m に受信誤差を足した余裕） */
const TOW_PAIR_MAX_HORIZ_M = 200;
/** 曳航中とみなす高度差 */
const TOW_PAIR_MAX_VERT_M = 100;
/** これだけ連続して近接したらペア確定。一度離れたら数え直す */
const TOW_PAIR_MIN_SAMPLES = 3;
/**
 * これを超える上昇率で上がり続ける機体は、曳航機に引かれていない。
 * たきかわ実測（2026-09-12）: ウィンチ発航は 8〜18.4 m/s を 33秒continuous、
 * 同じ日の曳航6機は 6 m/s すら1秒も continuous しなかった（離陸直後の
 * 引き起こしで 6.1〜6.2 m/s の単発が出るだけ）。境目は十分に広い。
 */
const WINCH_CLIMB_MS = 7;
/**
 * 曳航機の離脱を見てから、グライダー自身の離脱検知を待つ時間。
 * 自分で測れた値のほうが確かなので、待ってから空欄のときだけ写す。
 */
const TOW_PAIR_INFER_GRACE_SEC = 120;
/**
 * 受信の途切れているあいだに離陸していた機体（FLARM の電源を入れたのが離陸後、等）は、
 * 見つかった時刻が離陸時刻ではない。並んで上がっている曳航機をこれだけ探し、
 * 見つからなければ見つかった時刻で飛行を作る。
 */
const LATE_TAKEOFF_WAIT_SEC = 60;
/** 離陸時刻を引き継げる曳航機は、この時間内に離陸したものに限る */
const LATE_TAKEOFF_LOOKBACK_SEC = 20 * 60;

// ── ウィンチ発航の離脱 ──────────────────────────────────────────────────
// 曳航は索が外れると機体が自分の速度まで落ちるので減速で分かるが、ウィンチは
// 逆に機首を下げて加速する。減速では取れないので、上昇率の崩れで見る。
// たきかわ実測: 上昇 8〜18 m/s が 35秒続き、最後の 2秒で 8.0 → 5.4 → 0.5 と
// 落ちた。この崩れが飛行中で最も鋭い変化で、離脱の瞬間そのもの。
/** これだけ上昇が続いたらウィンチ発航中とみなす */
const WINCH_CLIMB_MIN_SEC = 5;
/** ウィンチ発航の急上昇は離陸直後に始まる。遅れて来た上昇はサーマル */
const WINCH_START_MAX_SEC = 60;
/** 上昇がここまで落ちたら索が外れた */
const WINCH_RELEASE_CLIMB_MS = 2;
/** ウィンチ発航は 30〜60秒で終わる。これを過ぎたら発航ではない */
const WINCH_MAX_AGE_SEC = 180;

// ── 復号エラーの位置を弾く（送信側 ogn-mqtt.py と同じ考え方） ────────────
const MAX_ALTITUDE_M = 15000;
const MIN_ALTITUDE_M = -500;
const MAX_GROUND_SPEED_MS = 150;
const MAX_VERTICAL_SPEED_MS = 40;
/** 直前の位置がこれより古いと、動いたのか壊れたのか判断できないので裏付けを取り直す */
const JUMP_MAX_GAP_SEC = 300;
/** 連続でこれだけ弾いたら基準側が怪しいので取り直す */
const MAX_CONSECUTIVE_REJECTS = 5;
/**
 * 初見・無受信明けの位置は、互いにつながった位置がこれだけそろってから使う。
 * 電源を入れた直後の FLARM は GPS が測位する前の位置を出すことがある
 * （たきかわ実測: 対地3mで 539 km/h・238km 先、対地8235m・102km 先）。
 * 比べる相手がいない1点目は跳び判定では弾けないので、続く位置で裏付ける。
 */
const ACQUIRE_CONFIRM_FIXES = 3;
/**
 * 裏付けがこれだけ続けて取れなければ、その位置を採用する。どんな入力でも
 * 「いつまでも追跡されない機体」を作らないための安全弁。
 */
const ACQUIRE_MAX_DISCARDS = 10;

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
  /** 離脱高度を曳航機から写した場合に true。自分で測れた値には付かない */
  releaseInferred?: boolean;
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
  /** 受け取った時刻。受信の途切れや相手の位置の鮮度はこれで見る */
  timeMs: number;
  /**
   * 位置そのものの時刻（FLARM）。ogn-mqtt は初見の機体の位置をまとめて流すので、
   * 受け取った時刻では間隔が 0 になる。動きの妥当性はこちらで見る。
   * 時刻を持たない位置（IGC シミュレータ等）は null で、妥当性は判断しない。
   */
  posMs: number | null;
  /** 対地速度。裏付け待ちの位置が既に滑走中だったかを見る */
  speedMs?: number;
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
  /** この滑走中に受信機が「飛行中」と言ったか（偽の離陸を落とすために見る） */
  rxAirborneSeen: boolean;
  /** 低空・低速が続き始めた時刻。接地の判断に使う */
  lowSlowSinceMs: number | null;
  /** 滑走を始めた時刻。浮いたらこの時刻を離陸時刻として飛行を作る */
  rollingSinceMs: number | null;
  /** 滑走を始めたときの対地高度と位置 */
  rollingAgl: number;
  rollingLat: number;
  rollingLon: number;
  recent: Sample[];
  /** この機体が曳航機かどうか。相手側から引くので状態に持たせる */
  isTow: boolean;
  /** 曳航でつながっていると判断した相手 */
  pairDeviceId: string | null;
  /** 相手と近接して観測できた連続回数 */
  pairSamples: number;
  /**
   * 索でつながっていたと確定した。曳航機の離脱検知は最高高度から 50m 下がって
   * 初めて出るので、実際の離脱から十数秒遅れる。そのころには2機は離れていて
   * 近接は途切れている。「この飛行で組だった」のは離脱の瞬間に確かめ直せる
   * ことではないので、一度確定したら飛行が終わるまで持ち続ける。
   */
  pairConfirmed: boolean;
  /** ウィンチ域の上昇が続き始めた時刻。途切れたら null に戻す */
  winchClimbSinceMs: number | null;
  /** ウィンチ発航中と判断した。離脱を取るまで下ろさない */
  winchLaunch: boolean;
  /** 相手の離脱高度。猶予のあいだ自力検知を待ってから使う */
  pendingReleaseAlt: number | null;
  pendingReleaseDist: number | null;
  pendingSinceMs: number | null;
  /** 状態（地上か飛行中か）を、裏付けの取れた位置で決めたか。決まるまで表に出さない */
  initialized: boolean;
  /** 初見・無受信明けに裏付けを待っている位置。null なら通常の判定中 */
  acquiring: LastFix[] | null;
  /** 裏付けが取れずに位置を捨てた連続回数 */
  acquireDiscards: number;
  /** 離陸を観測していない「飛行中」の機体が、地上で止まり始めた時刻 */
  stillSinceMs: number | null;
  /** 滑走を始めてから 30 km/h 超で受けた位置の数 */
  rollingFixes: number;
  /** 滑走中に続けて対地20m以上で受けた位置の数 */
  airborneFixes: number;
  /** 受信の途切れているあいだに離陸していた機体を見つけた時刻。飛行を作るまで非 null */
  lateSinceMs: number | null;
  /** その機体と並んで上がっている曳航機の候補と、続けて並んで見えた回数 */
  lateTowId: string | null;
  lateTowSamples: number;
  /**
   * 並ぶ曳航機が見つからなかったとき、見つかった時刻で飛行を作るか。
   * 地上にいた機体なら作る（離陸したのは確か）。上空で初めて見た機体は、
   * 飛行場の外から入ってきただけかもしれないので作らない。
   */
  lateCreateIfAlone: boolean;
  /** 最高高度を記録した時刻と、そのときの上昇率 */
  maxAltAtMs: number | null;
  maxAltClimbMs: number | null;
  /** 最高高度のあと、次の位置が届くまでの間隔。まだ届いていなければ null */
  afterMaxGapMs: number | null;
  /** 最高高度の位置の直前に受けた位置から、最高高度までの間隔と、直前の位置の上昇率 */
  maxAltGapBeforeMs: number | null;
  maxAltClimbBeforeMs: number | null;
  /** 飛行中に直前に受けた位置の時刻と上昇率 */
  prevAirFixMs: number | null;
  prevAirClimbMs: number | null;
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
    console.log(`[flight-tracker] landing ${deviceId} ${time}`);
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
  tr.rxAirborneSeen = false;
  tr.lowSlowSinceMs = null;
  tr.rollingSinceMs = null;
  tr.rollingFixes = 0;
  tr.airborneFixes = 0;
  tr.stillSinceMs = null;
  tr.lateSinceMs = null;
  tr.lateTowId = null;
  tr.lateTowSamples = 0;
  tr.maxAltAtMs = null;
  tr.maxAltClimbMs = null;
  tr.afterMaxGapMs = null;
  tr.maxAltGapBeforeMs = null;
  tr.maxAltClimbBeforeMs = null;
  tr.prevAirFixMs = null;
  tr.prevAirClimbMs = null;
  clearPair(tr);
}

/** 飛行を作って「飛行中」にする。離陸時刻は滑走を始めた時刻（または曳航機から引き継いだ時刻） */
function openFlight(
  deviceId: string, registration: string, tr: TrackingState,
  takeoffMs: number, takeoffAgl: number, agl: number,
): void {
  const s = S();
  const entry: FlightLogEntry = {
    id: `f${Date.now().toString(36)}${(s.seq++).toString(36)}`,
    registration,
    deviceId,
    takeoffTime: clockStr(takeoffMs),
    landingTime: null,
    releaseAlt: null,
    releaseDist: null,
  };
  s.flights = [...s.flights, entry];
  console.log(`[flight-tracker] takeoff ${deviceId} ${entry.takeoffTime}`);
  // 同じ機体が離陸した以上、前の飛行はもう終わっている
  closeOpenFlights(deviceId, "", entry.id);
  tr.phase = "airborne";
  tr.flightId = entry.id;
  tr.takeoffMs = takeoffMs;
  tr.maxAltAgl = agl;
  tr.maxAltAtMs = Date.now();
  tr.maxAltClimbMs = null;
  tr.afterMaxGapMs = null;
  tr.maxAltGapBeforeMs = null;
  tr.maxAltClimbBeforeMs = null;
  tr.takeoffAgl = takeoffAgl;
  tr.wasHigh = agl > AIRBORNE_CONFIRM_AGL_M;
  tr.lowSlowSinceMs = null;
  tr.rollingSinceMs = null;
  tr.lateSinceMs = null;
  tr.lateTowId = null;
  tr.lateTowSamples = 0;
  clearPair(tr);
}

/**
 * 受信の途切れているあいだに離陸していた機体の、離陸時刻を決める。
 * 曳航機と並んで上がっていれば、その曳航機の離陸時刻を使って索の組にする
 * （曳航機が離脱すると、その高度がこの機体にも写る）。
 * 並ぶ曳航機がいなければ、見つかった時刻で飛行を作る。
 */
function resolveLateTakeoff(
  deviceId: string, registration: string, tr: TrackingState,
  fix: LastFix, agl: number, nowMs: number,
): void {
  const s = S();
  let towId: string | null = null;
  let found = 0;
  if (!tr.isTow) {
    for (const [otherId, other] of s.tracking) {
      if (otherId === deviceId || !other.isTow) continue;
      // 離脱済みの曳航機は、もう索の相手ではない
      if (other.phase !== "airborne" || other.takeoffMs === null) continue;
      if (nowMs - other.takeoffMs > LATE_TAKEOFF_LOOKBACK_SEC * 1000) continue;
      if (other.pairConfirmed && other.pairDeviceId !== deviceId) continue;   // 別の機体を曳いている
      if (!isAlongside(other, fix.lat, fix.lon, fix.altM, nowMs)) continue;
      towId = otherId;
      found += 1;
    }
  }

  const tow = found === 1 && towId ? s.tracking.get(towId) : undefined;
  if (towId && tow && tow.takeoffMs !== null) {
    tr.lateTowSamples = tr.lateTowId === towId ? tr.lateTowSamples + 1 : 1;
    tr.lateTowId = towId;
    if (tr.lateTowSamples < TOW_PAIR_MIN_SAMPLES) return;
    // 上空で初めて見た機体は地上の高度を知らないので、滑空場の標高（対地0m）から上がったものとする
    openFlight(deviceId, registration, tr, tow.takeoffMs, tr.lateCreateIfAlone ? tr.takeoffAgl : 0, agl);
    tr.pairDeviceId = towId;
    tr.pairSamples = TOW_PAIR_MIN_SAMPLES;
    tr.pairConfirmed = true;
    tow.pairDeviceId = deviceId;
    tow.pairSamples = TOW_PAIR_MIN_SAMPLES;
    tow.pairConfirmed = true;
    console.log(`[flight-tracker] tow pair ${deviceId} + ${towId} (takeoff time taken from the tow plane)`);
    return;
  }

  tr.lateTowId = null;
  tr.lateTowSamples = 0;
  const since = tr.lateSinceMs;
  if (since !== null && nowMs - since >= LATE_TAKEOFF_WAIT_SEC * 1000) {
    if (tr.lateCreateIfAlone) {
      openFlight(deviceId, registration, tr, since, tr.takeoffAgl, agl);
    } else {
      tr.lateSinceMs = null;   // 上空から入ってきた機体。飛行は作らない
    }
  }
}

/** 2つの位置の間の動きが、機体として物理的にありえるか */
function isPlausibleMove(from: LastFix, to: LastFix): boolean {
  if (from.posMs === null || to.posMs === null) return true;
  const dtSec = (to.posMs - from.posMs) / 1000;
  if (dtSec <= 0) return true;
  if (haversineM(from.lat, from.lon, to.lat, to.lon) / dtSec > MAX_GROUND_SPEED_MS) return false;
  return Math.abs(to.altM - from.altM) / dtSec <= MAX_VERTICAL_SPEED_MS;
}

/**
 * 初見・無受信明けの位置を裏付ける。続けて届いた位置どうしが物理的につながって
 * いれば本物とみなす。つながらなければ、それまでの位置を捨てて数え直す
 * （壊れているのが古いほうでも新しいほうでも、次の位置で必ず解消する）。
 * 裏付けが取れたら true を返し、その位置から通常の判定に戻す。
 */
function acquirePosition(deviceId: string, tr: TrackingState, cur: LastFix): boolean {
  const buf = tr.acquiring ?? [];
  const last = buf[buf.length - 1];
  let force = false;
  if (last && !isPlausibleMove(last, cur)) {
    tr.acquireDiscards += 1;
    force = tr.acquireDiscards >= ACQUIRE_MAX_DISCARDS;
    console.log(force
      ? `[flight-tracker] ${deviceId}: accepted position after ${tr.acquireDiscards} failed confirmations`
      : `[flight-tracker] ${deviceId}: discarded ${buf.length} unconfirmed position(s)`);
    buf.length = 0;
  }
  buf.push(cur);
  tr.acquiring = buf;
  if (!force && buf.length < ACQUIRE_CONFIRM_FIXES) return false;
  tr.acquireDiscards = 0;
  tr.acquiring = null;
  tr.lastFix = cur;
  tr.rejects = 0;
  return true;
}

/** 曳航ペアの状態を捨てる。次の飛行に前の索の相手を持ち越さない */
function clearPair(tr: TrackingState): void {
  tr.pairDeviceId = null;
  tr.pairSamples = 0;
  tr.pairConfirmed = false;
  tr.winchClimbSinceMs = null;
  tr.winchLaunch = false;
  tr.pendingReleaseAlt = null;
  tr.pendingReleaseDist = null;
  tr.pendingSinceMs = null;
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
    applyPendingRelease(tr, nowMs);
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

/** 相手が「索でつながっていそうな位置」にいるか */
function isAlongside(
  other: TrackingState, lat: number, lon: number, altM: number, nowMs: number,
): boolean {
  const fix = other.lastFix;
  if (!fix) return false;
  if ((nowMs - fix.timeMs) / 1000 > TOW_PAIR_FIX_MAX_AGE_SEC) return false;
  if (Math.abs(altM - fix.altM) > TOW_PAIR_MAX_VERT_M) return false;
  return haversineM(lat, lon, fix.lat, fix.lon) <= TOW_PAIR_MAX_HORIZ_M;
}

/**
 * いま索でつながっている相手を探す。曳航機とグライダーが、ほぼ同時に離陸して
 * 並んで上がっていれば曳航中とみなす。近接が続いた回数を数え、たまたま
 * すれ違っただけの機体を除く。
 *
 * ウィンチ発航は相手がいないので、そもそもここには掛からない。同じ滑走路で
 * 曳航離陸と同時にウィンチ発航が出た場合は、上昇率で分かれる。
 */
function updateTowPair(
  deviceId: string, tr: TrackingState,
  lat: number, lon: number, altM: number, climbMs: number, nowMs: number,
): void {
  const s = S();
  if (tr.pairConfirmed) return;   // 確定済み。離れても組は変わらない
  if (tr.phase !== "airborne" || tr.takeoffMs === null) return;
  if (nowMs - tr.takeoffMs > RELEASE_MAX_AGE_SEC * 1000) return;

  // 索で引かれている機体はこんなに上がらない（ウィンチ発航・サーマル）
  if (climbMs > WINCH_CLIMB_MS) {
    tr.pairDeviceId = null;
    tr.pairSamples = 0;
    return;
  }

  const found: string[] = [];
  for (const [otherId, other] of s.tracking) {
    if (otherId === deviceId) continue;
    if (other.isTow === tr.isTow) continue;   // 曳航機とグライダーの組だけ
    if (other.phase !== "airborne" || other.takeoffMs === null) continue;
    if (Math.abs(other.takeoffMs - tr.takeoffMs) > TOW_PAIR_TAKEOFF_WINDOW_SEC * 1000) continue;
    if (!isAlongside(other, lat, lon, altM, nowMs)) continue;
    found.push(otherId);
  }

  // 相手が絞れないときは決めない（編隊で上がっている、位置が荒れている）
  if (found.length !== 1) {
    tr.pairSamples = 0;
    return;
  }
  if (tr.pairDeviceId !== found[0]) {
    tr.pairDeviceId = found[0];
    tr.pairSamples = 0;
  }
  tr.pairSamples += 1;
  if (tr.pairSamples >= TOW_PAIR_MIN_SAMPLES) {
    tr.pairConfirmed = true;
    console.log(`[flight-tracker] tow pair ${deviceId} + ${found[0]}`);
  }
}

/**
 * 曳航機から預かった離脱高度を、猶予のあとで飛行記録へ写す。
 * 自分で測れた値があればそちらを残す。
 */
function applyPendingRelease(tr: TrackingState, nowMs: number): void {
  const s = S();
  if (tr.pendingSinceMs === null || tr.pendingReleaseAlt === null) return;
  if (nowMs - tr.pendingSinceMs < TOW_PAIR_INFER_GRACE_SEC * 1000) return;

  const id = tr.flightId;
  const alt = tr.pendingReleaseAlt;
  const dist = tr.pendingReleaseDist;
  tr.pendingReleaseAlt = null;
  tr.pendingReleaseDist = null;
  tr.pendingSinceMs = null;
  if (!id) return;

  const f = s.flights.find((x) => x.id === id);
  if (!f || f.releaseAlt != null) return;
  s.flights = s.flights.map((x) =>
    x.id === id
      ? { ...x, releaseAlt: alt, releaseDist: dist, releaseInferred: true }
      : x);
  console.log(`[flight-tracker] release ${f.deviceId} ${alt}m (from tow plane)`);
  if (tr.phase === "airborne") tr.phase = "released";
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
  // 接頭辞(ICA/FLR/OGN)は同じ送信機でも受信内容と登録内容で食い違うことがある。
  // 実体は後ろ6桁のアドレスなので、完全一致で外れたらアドレスで引き直す。
  const rec = lookupByDeviceId(s.aircraftDb, deviceId);
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
  if (tr) tr.isTow = tow;   // 運用中に機体種別を設定されることがある
  if (!tr) {
    // 初めて見る機体。地上か飛行中かは、位置の裏付けが取れてから決める。
    tr = {
      phase: "ground",
      lastFix: null,
      rejects: 0,
      flightId: null,
      takeoffMs: null,
      maxAltAgl: agl,
      takeoffAgl: agl,
      wasHigh: false,
      rxAirborneSeen: false,
      lowSlowSinceMs: null,
      rollingSinceMs: null,
      rollingAgl: 0,
      rollingLat: pos.latitude,
      rollingLon: pos.longitude,
      recent: [],
      isTow: tow,
      pairDeviceId: null,
      pairSamples: 0,
      pairConfirmed: false,
      winchClimbSinceMs: null,
      winchLaunch: false,
      pendingReleaseAlt: null,
      pendingReleaseDist: null,
      pendingSinceMs: null,
      initialized: false,
      acquiring: [],
      acquireDiscards: 0,
      stillSinceMs: null,
      rollingFixes: 0,
      airborneFixes: 0,
      lateSinceMs: null,
      lateTowId: null,
      lateTowSamples: 0,
      lateCreateIfAlone: false,
      maxAltAtMs: null,
      maxAltClimbMs: null,
      afterMaxGapMs: null,
      maxAltGapBeforeMs: null,
      maxAltClimbBeforeMs: null,
      prevAirFixMs: null,
      prevAirClimbMs: null,
    };
    s.tracking.set(deviceId, tr);
  }

  const cur: LastFix = {
    lat: pos.latitude,
    lon: pos.longitude,
    altM: pos.altitude_m,
    timeMs: nowMs,
    posMs: typeof pos.timestamp_epoch === "number" && Number.isFinite(pos.timestamp_epoch)
      ? pos.timestamp_epoch * 1000
      : null,
    speedMs,
  };

  // 無受信明けは、前の位置と比べて壊れているかを判断できない。その1点で状態を
  // 決めたり離陸を作ったりしないよう、続く位置で裏付けを取り直す。
  if (tr.acquiring === null && tr.lastFix && (nowMs - tr.lastFix.timeMs) / 1000 > JUMP_MAX_GAP_SEC) {
    tr.acquiring = [];
  }
  if (tr.acquiring !== null) {
    const confirmed = tr.acquiring;   // acquirePosition はこの配列に積む
    if (!acquirePosition(deviceId, tr, cur)) return;
    // 裏付けを待っていた位置が既に滑走中なら、滑走はその最初の位置から始まっている。
    // 裏付けに使った位置のぶん離陸時刻が遅れないよう、そこまで遡る。
    if (tr.initialized && tr.phase === "ground" && tr.rollingSinceMs === null) {
      let i = confirmed.length - 1;
      while (i > 0 && (confirmed[i - 1].speedMs ?? 0) > TAKEOFF_SPEED_MS) i -= 1;
      if ((cur.speedMs ?? 0) > TAKEOFF_SPEED_MS && i < confirmed.length - 1) {
        tr.rollingSinceMs = confirmed[i].timeMs;
        tr.rollingAgl = agl;
        tr.rollingLat = confirmed[i].lat;
        tr.rollingLon = confirmed[i].lon;
        tr.rollingFixes = confirmed.length - 1 - i;   // 今の位置はこのあと数える
        tr.airborneFixes = 0;
      }
    }
    if (!tr.initialized) {
      // 裏付けの取れた位置で初めて状態を決める。地上にいると確認できたときだけ "ground" から始める。
      // 電源投入直後の1点は GPS 測位前で速度も高度も壊れていることがある
      // （たきかわ 2026-09-13: 対地3m・539km/h・238km先）。高度と速度だけで
      // 決めると「飛行中」に固定され、その日の1便目をまるごと取りこぼす。
      // 受信機が「地上」と言っているならそれを信じる。逆向き（飛行中と言っている）
      // には使わない。着陸後も約20秒は飛行中のまま戻らないため。
      const rxOnGround = typeof pos.state === "number"
        ? pos.state < RX_AIRBORNE_MIN_STATE : null;
      const onGround = rxOnGround === true
        ? true
        : agl < ON_GROUND_AGL_M && speedMs < TAKEOFF_SPEED_MS;
      tr.phase = onGround ? "ground" : "airborne";
      tr.maxAltAgl = agl;
      tr.takeoffAgl = agl;
      tr.wasHigh = agl > AIRBORNE_CONFIRM_AGL_M;
      tr.initialized = true;
      if (!onGround && !tr.isTow) {
        // 上空で初めて見つかった。曳航機と並んで上がっていれば、受信できないまま
        // 曳航されてきたグライダー（受信機の再起動直後、FLARM を地上で入れなかった等）。
        // 並ぶ曳航機がいなければ、上空から入ってきた機体として飛行は作らない。
        tr.lateSinceMs = nowMs;
        tr.lateTowId = null;
        tr.lateTowSamples = 0;
        tr.lateCreateIfAlone = false;
      }
    } else if (tr.phase === "ground" && agl >= ON_GROUND_AGL_M) {
      // 地上にいた機体が、受信の途切れているあいだに離陸していた。たきかわ 2026-09-13
      // 実測: あるグライダーは地上で受信が2時間途切れ、次は曳航中の対地572m で見つかった
      // （実際の離陸は5分前）。見つかった時刻で離陸を作ると時刻がずれ、曳航機との
      // 組も離脱高度も取れないので、並んで上がる曳航機を探してから決める。
      tr.phase = "airborne";
      tr.maxAltAgl = agl;
      tr.wasHigh = agl > AIRBORNE_CONFIRM_AGL_M;
      tr.rollingSinceMs = null;
      tr.lateSinceMs = nowMs;
      tr.lateTowId = null;
      tr.lateTowSamples = 0;
      tr.lateCreateIfAlone = true;
      console.log(`[flight-tracker] ${deviceId}: reappeared in the air at ${Math.round(agl)}m, takeoff not observed`);
    }
  } else if (tr.lastFix && !isPlausibleMove(tr.lastFix, cur)) {
    // 直前の位置から見て、ありえない速度で動いていたら復号エラーとみなす
    tr.rejects += 1;
    if (tr.rejects < MAX_CONSECUTIVE_REJECTS) return;
    // 弾き続けるのは基準のほうが壊れている可能性がある。基準を捨てて裏付けを取り直す
    console.log(`[flight-tracker] ${deviceId}: position reference reset after ${tr.rejects} rejects`);
    tr.rejects = 0;
    tr.acquiring = [cur];
    return;
  } else {
    tr.rejects = 0;
    tr.lastFix = cur;
  }

  // 受信機が出す飛行状態。null = この送信側は値を出していない（従来どおりの判定に落とす）
  const rxState = typeof pos.state === "number" ? pos.state : null;
  const rxAirborne = rxState === null ? null : rxState >= RX_AIRBORNE_MIN_STATE;

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
    // 滑走の始まりを覚えておく。離陸時刻はここなので、あとで浮いたときに使う。
    if (speedMs > TAKEOFF_SPEED_MS) {
      if (tr.rollingSinceMs === null) {
        tr.rollingSinceMs = nowMs;
        tr.rollingAgl = agl;
        tr.rollingLat = pos.latitude;
        tr.rollingLon = pos.longitude;
        tr.rollingFixes = 0;
        tr.airborneFixes = 0;
      }
      tr.rollingFixes += 1;
    } else {
      tr.rollingSinceMs = null;   // 速度が落ちた＝離陸ではなかった
    }

    if (tr.rollingSinceMs !== null && nowMs - tr.rollingSinceMs > TAKEOFF_CONFIRM_SEC * 1000) {
      tr.rollingSinceMs = null;   // 走り続けているが浮かない＝地上滑走
    }
    if (tr.rollingSinceMs !== null) {
      // 受信機の飛行中ビットを「浮いた」の代わりには使えない。
      // このビットは着陸の滑走中も立ったままで、停止してから約20秒遅れて
      // しか戻らない（9/13 の実測: 13.1m/s で接地→停止→20秒後に 2→1）。
      // 代わりに使うと、着陸した曳航機が止まらずに次の索へ滑走する形を
      // 離陸と誤判定し、1分未満の偽の便ができる（9/12 の再生で3件発生した。
      // これは TAKEOFF_CONFIRM_AGL_M がもともと塞いでいた不具合そのもの）。
      // 浮いた判定は従来どおり対地高度で行い、ビットは下の「拒否」だけに使う。
      if (rxAirborne === true && speedMs >= RX_TAKEOFF_MIN_SPEED_MS) {
        tr.rxAirborneSeen = true;
      }
      tr.airborneFixes = agl >= TAKEOFF_CONFIRM_AGL_M ? tr.airborneFixes + 1 : 0;
    }

    // 浮いて初めて飛行として記録する。地上を走っただけでは作らない。
    // 1点だけの速度・高度では作らない（壊れた位置で偽の離陸ができる）。
    if (
      tr.rollingSinceMs !== null &&
      tr.rollingFixes >= TAKEOFF_CONFIRM_FIXES &&
      tr.airborneFixes >= TAKEOFF_CONFIRM_FIXES &&
      // 受信機がまだ「地上」と言っているあいだは飛行を作らない。
      // 格納庫付近の GPS ノイズで速度と高度だけが跳ねる形
      // （たきかわ 2026-09-13 17:21 の偽の便）をこれで落とせる。
      (rxState === null || tr.rxAirborneSeen) &&
      haversineM(tr.rollingLat, tr.rollingLon, pos.latitude, pos.longitude) >= TAKEOFF_CONFIRM_DIST_M
    ) {
      openFlight(deviceId, registration, tr, tr.rollingSinceMs, tr.rollingAgl, agl);
    }
    return;
  }

  if (agl > tr.maxAltAgl) {
    tr.maxAltAgl = agl;
    tr.maxAltAtMs = nowMs;
    tr.maxAltClimbMs = climbMs;
    tr.afterMaxGapMs = null;
    tr.maxAltGapBeforeMs = tr.prevAirFixMs !== null ? nowMs - tr.prevAirFixMs : null;
    tr.maxAltClimbBeforeMs = tr.prevAirClimbMs;
  } else if (tr.afterMaxGapMs === null && tr.maxAltAtMs !== null) {
    tr.afterMaxGapMs = nowMs - tr.maxAltAtMs;
  }
  tr.prevAirFixMs = nowMs;
  tr.prevAirClimbMs = climbMs;
  if (agl > AIRBORNE_CONFIRM_AGL_M) tr.wasHigh = true;

  // ── ウィンチ発航中かどうか ──
  // 離脱判定の高度ゲート(150m)より下から急上昇が始まるので、ここで見る。
  if (!tow && tr.phase === "airborne" && tr.takeoffMs !== null) {
    const ageSec = (nowMs - tr.takeoffMs) / 1000;
    if (climbMs >= WINCH_CLIMB_MS) {
      if (tr.winchClimbSinceMs === null) tr.winchClimbSinceMs = nowMs;
      // 離陸から間を置いて始まった上昇はサーマル。ウィンチ発航ではない
      if (
        (tr.winchClimbSinceMs - tr.takeoffMs) / 1000 <= WINCH_START_MAX_SEC &&
        nowMs - tr.winchClimbSinceMs >= WINCH_CLIMB_MIN_SEC * 1000
      ) {
        tr.winchLaunch = true;
      }
    } else {
      tr.winchClimbSinceMs = null;
    }
    if (ageSec > WINCH_MAX_AGE_SEC) tr.winchLaunch = false;
  }

  // サーバを再起動した直後は、飛行中の機体と記録の対応が切れている
  // （記録はブラウザの控えから戻される）。飛行中なら未着陸の記録を引き受けて、
  // その飛行の着陸がちゃんと入るようにする。追っていた記録が消された・
  // 入れ替わった場合も、ここで引き受け直す。
  if (tr.flightId && !s.flights.some((f) => f.id === tr.flightId)) tr.flightId = null;
  // 受信の途切れているあいだに離陸していた機体は、離陸時刻が決まるまで古い記録を引き受けない
  if (tr.lateSinceMs !== null) resolveLateTakeoff(deviceId, registration, tr, cur, agl, nowMs);
  if (!tr.flightId && tr.lateSinceMs === null) {
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
    } else if (!tow && tr.winchLaunch) {
      // ウィンチ発航。索が外れると上昇が一気に止まる。速度は見ない
      // （機首を下げて加速するので、曳航のような減速は起きない）。
      if (climbMs <= WINCH_RELEASE_CLIMB_MS) released = true;
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
      // 上昇を続けたまま受信が途切れた曳航機は、離脱の瞬間を見ていない。
      // 受信できた最高高度は離脱高度ではないので、空欄のまま手で入れてもらう。
      // 形は2通り。途切れる直前がまだ上昇中の最高点だった（その後の最高点は見えていない）か、
      // 上昇中に途切れて、明けた最初の位置が既に降下中の最高点だった（本当の最高点は途切れの中）か。
      const lostWhileClimbing =
        tr.afterMaxGapMs !== null && tr.afterMaxGapMs > RELEASE_UNSEEN_GAP_SEC * 1000 &&
        tr.maxAltClimbMs !== null && tr.maxAltClimbMs >= CLIMB_ACTIVE_MS;
      const foundDescending =
        tr.maxAltClimbMs !== null && tr.maxAltClimbMs <= RELEASE_UNSEEN_DESCENT_MS &&
        tr.maxAltGapBeforeMs !== null && tr.maxAltGapBeforeMs > RELEASE_UNSEEN_GAP_SEC * 1000 &&
        tr.maxAltClimbBeforeMs !== null && tr.maxAltClimbBeforeMs >= CLIMB_ACTIVE_MS;
      const unseen = tow && (lostWhileClimbing || foundDescending);
      if (unseen) {
        const gapSec = Math.round(((lostWhileClimbing ? tr.afterMaxGapMs : tr.maxAltGapBeforeMs) ?? 0) / 1000);
        console.log(`[flight-tracker] ${deviceId}: release not observed (no signal for ${gapSec}s ${lostWhileClimbing ? "after climbing at" : "before descending from"} ${alt}m), left blank`);
        // 索の相手も離脱は済んでいる。「飛行中」のまま残すと、あとでサーマルを抜けたときの
        // 減速を離脱と読んでしまう（たきかわ 2026-09-12 実測: 実際 約640m の便に 1134m）。
        if (tr.pairConfirmed && tr.pairDeviceId) {
          const mate = s.tracking.get(tr.pairDeviceId);
          if (mate && mate.phase === "airborne" && mate.flightId) {
            mate.phase = "released";
            mate.winchLaunch = false;
            mate.pendingReleaseAlt = null;
            mate.pendingReleaseDist = null;
            mate.pendingSinceMs = null;
            console.log(`[flight-tracker] ${tr.pairDeviceId}: released with ${deviceId}, altitude left blank`);
          }
        }
      } else {
        s.flights = s.flights.map((f) =>
          f.id === flight.id ? { ...f, releaseAlt: alt, releaseDist: distM } : f);
        console.log(`[flight-tracker] release ${deviceId} ${alt}m${tow ? " (tow plane)" : tr.winchLaunch ? " (winch)" : ""}`);
      }
      tr.winchLaunch = false;
      tr.winchClimbSinceMs = null;
      // 自分で測れたので、預かっていた値は捨てる
      tr.pendingReleaseAlt = null;
      tr.pendingReleaseDist = null;
      tr.pendingSinceMs = null;

      // 曳航機の離脱は確実に取れる。索の相手が分かっていれば、その高度を
      // 預けておく。グライダー自身が測れなかったときだけ、あとで使われる。
      if (tow && !unseen && tr.pairConfirmed && tr.pairDeviceId) {
        const mate = s.tracking.get(tr.pairDeviceId);
        if (mate && mate.phase === "airborne" && mate.flightId) {
          mate.pendingReleaseAlt = alt;
          mate.pendingReleaseDist = distM;
          mate.pendingSinceMs = nowMs;
        }
      }
    }
  }

  // 索でつながっている相手を追い、預かった離脱高度があれば頃合いを見て使う
  updateTowPair(deviceId, tr, pos.latitude, pos.longitude, pos.altitude_m, climbMs, nowMs);
  applyPendingRelease(tr, nowMs);

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
  // 高度が壊れている機体でも、受信機が地上と言っていて止まっていれば接地とみなす。
  // 受信機側は停止から約20秒遅れて戻るので、これだけを頼りにはしない。
  const stopped =
    (agl < AIRBORNE_CONFIRM_AGL_M || rxAirborne === false) &&
    speedMs < LANDING_SPEED_MS;
  const rolledOut =
    tr.lowSlowSinceMs !== null &&
    nowMs - tr.lowSlowSinceMs >= LANDING_ROLL_CONFIRM_SEC * 1000;

  // 高く上がらなかった飛行（低い場周、離陸中止）でも、離陸を観測できていれば
  // その飛行の終わりとして着陸を記録する。
  if ((tr.wasHigh || tr.takeoffMs !== null) && (stopped || rolledOut)) {
    recordLanding(deviceId, tr, clockStr());
    toGround(tr, agl);
    return;
  }

  // 離陸を観測していない「飛行中」の機体（受信を始めたとき低空を飛んでいた、
  // 壊れた位置で飛行中と判断した等）が地上で止まったままなら、地上にいる。
  // 着陸時刻は分からないので記録せず、状態だけ戻す。戻さないと次の離陸を記録できない。
  if (tr.phase === "airborne" && tr.takeoffMs === null && !tr.wasHigh && stopped && agl < ON_GROUND_AGL_M) {
    if (tr.stillSinceMs === null) tr.stillSinceMs = nowMs;
    if (nowMs - tr.stillSinceMs >= UNOBSERVED_GROUND_CONFIRM_SEC * 1000) {
      console.log(`[flight-tracker] ${deviceId}: stopped on the ground without an observed takeoff, back to ground`);
      toGround(tr, agl);
    }
  } else {
    tr.stillSinceMs = null;
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
  for (const [id, tr] of S().tracking) {
    if (tr.initialized) out[id] = tr.phase;   // 位置の裏付けが取れるまでは状態を出さない
  }
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
