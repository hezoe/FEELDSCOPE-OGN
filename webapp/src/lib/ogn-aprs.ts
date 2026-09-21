// APRS-IS 直結 OGN クライアント(サーバ側・webアプリ内常駐)。
// ogn.ezoe.net(ogn-collect) と同じく aprs.glidernet.org へ読み取り専用で接続し、
// 空港中心の範囲フィルタ(r/lat/lon/km)で OGN 機ビーコンを購読・解析してメモリに保持する。
// /api/open-ogn からオンデマンドで起動(要求が来たら接続、一定時間 無要求で切断)。
// RND(ランダムID/EPRA)は匿名前提のため除外(ogn.ezoe.net と同じ扱い)。
import net from "node:net";

const APRS_HOST = "aprs.glidernet.org";
const APRS_PORT = 14580;
const RADIUS_NM = 50;
const RADIUS_KM = Math.round(RADIUS_NM * 1.852 * 10) / 10; // 92.6km
const STALE_MS = 90_000;      // 直近90秒 受信の無い機は落とす
const IDLE_MS = 60_000;       // /api/open-ogn への要求が60秒無ければ切断
const RECONNECT_MS = 10_000;  // 切断後の再接続間隔
const KEEPALIVE_MS = 240_000; // APRS-IS へ 4分ごとに keepalive コメント

export interface OgnAircraft {
  device_id: string;   // 例 FLRDDA5BA (接頭辞+6hex)
  hex: string;         // 6hex アドレス
  latitude: number;
  longitude: number;
  altitude_m: number | null;
  heading_deg: number;
  ground_speed_ms: number;
  aircraft_type: number | null; // OGN aircraft type code
  seen_at: number;
}

const store = new Map<string, OgnAircraft>(); // key = hex
let sock: net.Socket | null = null;
let buf = "";
let curCenter = "";          // "lat,lon" (接続中フィルタ中心)
let wantCenter: { lat: number; lon: number } | null = null;
let lastRequest = 0;         // 直近に /api/open-ogn が呼ばれた時刻
let connecting = false;
let idleTimer: NodeJS.Timeout | null = null;
let keepaliveTimer: NodeJS.Timeout | null = null;
let reconnectTimer: NodeJS.Timeout | null = null;

const CALL = "FSCP" + Math.random().toString(16).slice(2, 6).toUpperCase(); // 読み取り専用の適当なcall

// ── OGN ビーコン解析 ─────────────────────────────────────────────
function parseBeacon(line: string): OgnAircraft | null {
  const gt = line.indexOf(">");
  const colon = line.indexOf(":");
  if (gt < 1 || colon < gt) return null;
  const src = line.slice(0, gt).trim().toUpperCase(); // 例 FLRDDA5BA
  const body = line.slice(colon + 1);
  // 位置: /HHMMSSh DDMM.mmN /(sym table) DDDMM.mmE <sym>
  const pm = body.match(/^[/@](\d{6})[hz](\d{2})(\d{2}\.\d{2})([NS])(.)(\d{3})(\d{2}\.\d{2})([EW])(.)/);
  if (!pm) return null;
  let lat = parseInt(pm[2], 10) + parseFloat(pm[3]) / 60; if (pm[4] === "S") lat = -lat;
  let lon = parseInt(pm[6], 10) + parseFloat(pm[7]) / 60; if (pm[8] === "W") lon = -lon;
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  const rest = body.slice(pm[0].length);
  // course/speed(ノット): NNN/NNN
  const cs = rest.match(/^(\d{3})\/(\d{3})/);
  const course = cs ? parseInt(cs[1], 10) : 0;
  const speedKt = cs ? parseInt(cs[2], 10) : 0;
  // 高度 /A=NNNNNN (feet)
  const am = rest.match(/\/A=(\d{6})/);
  const altFt = am ? parseInt(am[1], 10) : null;
  // OGN id: 標準 idXXYYYYYY(8桁) と Naviter系(OGNAVI) の id+4桁+6桁(10桁, 例 id042084D1D3) の両対応。
  // 末尾6桁をアドレス、先頭バイトを種別/状態バイトとして扱う。
  const idm = rest.match(/\bid([0-9A-Fa-f]{2,4})([0-9A-Fa-f]{6})\b/);
  if (!idm) return null;
  const typeByte = parseInt(idm[1].slice(0, 2), 16); // 先頭バイト(種別/状態)
  const addr = idm[2].toUpperCase();
  // アドレス種別はソースコールサイン接頭辞(FLR/ICA/OGN/RND)を優先。無ければ種別バイト下位2bit。
  const sp = src.slice(0, 3);
  const addrType =
    sp === "RND" ? 0 : sp === "ICA" ? 1 : sp === "FLR" ? 2 : sp === "OGN" ? 3 : (typeByte & 0x03);
  const acftType = (typeByte >> 2) & 0x0f;
  if (addrType === 0) return null;          // RND(匿名) は除外
  const prefix = addrType === 1 ? "ICA" : addrType === 2 ? "FLR" : "OGN";
  return {
    device_id: prefix + addr,
    hex: addr,
    latitude: Math.round(lat * 1e5) / 1e5,
    longitude: Math.round(lon * 1e5) / 1e5,
    altitude_m: altFt != null ? Math.round(altFt * 0.3048) : null,
    heading_deg: course,
    ground_speed_ms: Math.round(speedKt * 0.514444 * 10) / 10,
    aircraft_type: acftType,
    seen_at: Date.now(),
  };
}

function handleLine(line: string) {
  if (!line || line[0] === "#") return; // サーバコメント/keepalive
  try {
    const ac = parseBeacon(line);
    if (ac) store.set(ac.hex, ac);
  } catch { /* 壊れた行は無視 */ }
}

// ── 接続管理 ─────────────────────────────────────────────────────
function clearTimers() {
  if (keepaliveTimer) { clearInterval(keepaliveTimer); keepaliveTimer = null; }
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
}

function disconnect() {
  clearTimers();
  if (sock) { try { sock.destroy(); } catch { /* noop */ } sock = null; }
  connecting = false;
  curCenter = "";
  buf = "";
}

function connect(lat: number, lon: number) {
  if (connecting || sock) return;
  connecting = true;
  const center = `${lat.toFixed(3)},${lon.toFixed(3)}`;
  const s = net.connect({ host: APRS_HOST, port: APRS_PORT });
  s.setEncoding("utf8");
  s.setTimeout(0);
  s.on("connect", () => {
    connecting = false;
    sock = s;
    curCenter = center;
    // 読み取り専用ログイン + 範囲フィルタ
    s.write(`user ${CALL} pass -1 vers feeldscope 1.0 filter r/${lat}/${lon}/${RADIUS_KM}\r\n`);
    keepaliveTimer = setInterval(() => { try { s.write(`# keepalive\r\n`); } catch { /* noop */ } }, KEEPALIVE_MS);
  });
  s.on("data", (chunk: string) => {
    buf += chunk;
    let nl;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).replace(/\r$/, "");
      buf = buf.slice(nl + 1);
      handleLine(line);
    }
  });
  const onGone = () => {
    clearTimers();
    if (sock === s || connecting) { sock = null; connecting = false; }
    // まだ使われている(直近要求あり)なら再接続
    if (Date.now() - lastRequest < IDLE_MS && wantCenter) {
      reconnectTimer = setTimeout(() => { if (wantCenter) connect(wantCenter.lat, wantCenter.lon); }, RECONNECT_MS);
    }
  };
  s.on("error", onGone);
  s.on("close", onGone);
}

function scheduleIdleCheck() {
  if (idleTimer) return;
  idleTimer = setInterval(() => {
    if (Date.now() - lastRequest > IDLE_MS) {
      disconnect();
      if (idleTimer) { clearInterval(idleTimer); idleTimer = null; }
    }
  }, 15_000);
}

/** /api/open-ogn から呼ぶ。中心(空港)を指定して購読を維持する。 */
export function ensureOgn(lat: number, lon: number): void {
  lastRequest = Date.now();
  wantCenter = { lat, lon };
  const center = `${lat.toFixed(3)},${lon.toFixed(3)}`;
  if (sock && center !== curCenter) {
    // 中心が変わったら張り直す
    disconnect();
    connect(lat, lon);
  } else if (!sock && !connecting) {
    connect(lat, lon);
  }
  scheduleIdleCheck();
}

/** 現在保持している OGN 機(古いものは除外)。 */
export function getOgnAircraft(): OgnAircraft[] {
  const now = Date.now();
  const out: OgnAircraft[] = [];
  for (const [hex, a] of store) {
    if (now - a.seen_at > STALE_MS) { store.delete(hex); continue; }
    out.push(a);
  }
  return out;
}

export function ognStatus() {
  return { connected: !!sock, center: curCenter, count: store.size, last_request: lastRequest ? new Date(lastRequest).toISOString() : null, radius_nm: RADIUS_NM };
}
