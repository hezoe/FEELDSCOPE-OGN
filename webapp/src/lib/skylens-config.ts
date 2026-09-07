// SkyLens の設定ファイルを読み書きする共通処理。
// API ルートは決められた関数しか export できないため、ここに分けている。
import { exec } from "child_process";
import { promisify } from "util";
import { readFile, writeFile } from "fs/promises";
import { existsSync } from "fs";

const execAsync = promisify(exec);

const SKYLENS_DIR = process.env.FEELDSCOPE_SKYLENS_DIR || "/home/pi/skylens";
const SKYLENS_CONFIG = `${SKYLENS_DIR}/config.yml`;
const SKYLENS_LICENSE = `${SKYLENS_DIR}/node.lic`;
const RTLSDR_OGN_CONF_PATHS = ["/home/pi/rtlsdr-ogn.conf", "/boot/rtlsdr-ogn.conf"];
const OGN_RECEIVER_CONF_PATH = "/boot/OGN-receiver.conf";

// 局位置は OGN と共有する。どちらの画面から変えても両方の設定に書き込む。
export const SHARED_FIELDS = ["latitude", "longitude", "elevationM"] as const;

// R820T が実際に持つゲイン段。中途半端な値を入れても最寄りに丸められるため候補を出す
export const GAIN_STEPS = [0, 16.6, 22.9, 28.0, 32.8, 37.2, 40.2, 44.5, 49.6];

export interface SkylensConfig {
  stationId: string;
  // --- OGN と共有 ---
  latitude: number;
  longitude: number;
  elevationM: number;          // 標高(MSL)。config.yml には楕円体高で書く
  // --- SkyLens 固有 ---
  geoidSeparationM: number;    // 楕円体高 = 標高 + ジオイド高
  sampleRate: number;
  gain: number;                // 0 = AGC
  ppmCorrection: number;
  biasT: boolean;
  udpEnable: boolean;
  udpAddress: string;
  udpPort: number;
  tcpEnable: boolean;
  tcpPort: number;
  monitoringPort: number;
  sendHeartbeat: boolean;
  sendTraffic: boolean;
  sendAlertzone: boolean;
  sendStatistics: boolean;
  sqliteEnable: boolean;
  logVerbosity: string;
}

const DEFAULT_CONFIG: SkylensConfig = {
  stationId: "",
  latitude: 0,
  longitude: 0,
  elevationM: 0,
  geoidSeparationM: 37,
  sampleRate: 1600000,
  gain: 0,
  ppmCorrection: 0,
  biasT: false,
  udpEnable: true,
  udpAddress: "127.0.0.1",
  udpPort: 8001,
  tcpEnable: true,
  tcpPort: 8002,
  monitoringPort: 8003,
  sendHeartbeat: true,
  sendTraffic: true,
  sendAlertzone: true,
  sendStatistics: true,
  sqliteEnable: false,
  logVerbosity: "info",
};

function grabNumber(text: string, re: RegExp, fallback: number): number {
  const m = text.match(re);
  if (!m) return fallback;
  const v = parseFloat(m[1]);
  return isFinite(v) ? v : fallback;
}

function grabBool(text: string, re: RegExp, fallback: boolean): boolean {
  const m = text.match(re);
  if (!m) return fallback;
  return /^(true|1|yes)$/i.test(m[1].trim());
}

function grabString(text: string, re: RegExp, fallback: string): string {
  const m = text.match(re);
  return m ? m[1].trim().replace(/^["']|["']$/g, "") : fallback;
}

/** config.yml を読む。値はすべて単純なスカラなので素朴なパースで足りる。 */
export async function readSkylensConfig(): Promise<SkylensConfig> {
  let text = "";
  try {
    text = await readFile(SKYLENS_CONFIG, "utf-8");
  } catch {
    return { ...DEFAULT_CONFIG };
  }

  // ジオイド高は SkyLens の設定項目ではないので、当方の機械可読コメントに保存している
  const geoid = grabNumber(text, /^#\s*feeldscope_geoid_separation:\s*([+\-\d.]+)/m,
    DEFAULT_CONFIG.geoidSeparationM);
  const altitudeHae = grabNumber(text, /^\s*altitude:\s*([+\-\d.]+)/m, geoid);

  return {
    stationId: grabString(text, /^\s*id:\s*([^\s#]+)/m, ""),
    latitude: grabNumber(text, /^\s*latitude:\s*([+\-\d.]+)/m, 0),
    longitude: grabNumber(text, /^\s*longitude:\s*([+\-\d.]+)/m, 0),
    elevationM: Math.round((altitudeHae - geoid) * 10) / 10,
    geoidSeparationM: geoid,
    sampleRate: grabNumber(text, /^\s*sample_rate:\s*(\d+)/m, DEFAULT_CONFIG.sampleRate),
    gain: grabNumber(text, /^\s*gain:\s*([+\-\d.]+)/m, DEFAULT_CONFIG.gain),
    ppmCorrection: grabNumber(text, /^\s*ppm_correction:\s*([+\-\d.]+)/m, 0),
    biasT: grabBool(text, /^\s*bias_t:\s*(\S+)/m, false),
    udpEnable: grabBool(text, /udp:\s*[\s\S]*?enable:\s*(\S+)/m, true),
    udpAddress: grabString(text, /udp:\s*[\s\S]*?address:\s*([^\s#]+)/m, "127.0.0.1"),
    udpPort: grabNumber(text, /udp:\s*[\s\S]*?port:\s*(\d+)/m, 8001),
    tcpEnable: grabBool(text, /tcp:\s*[\s\S]*?enable:\s*(\S+)/m, true),
    tcpPort: grabNumber(text, /tcp:\s*[\s\S]*?port:\s*(\d+)/m, 8002),
    monitoringPort: grabNumber(text, /monitoring:\s*[\s\S]*?port:\s*(\d+)/m, 8003),
    sendHeartbeat: grabBool(text, /^\s*heartbeat:\s*(\S+)/m, true),
    sendTraffic: grabBool(text, /^\s*traffic:\s*(\S+)/m, true),
    sendAlertzone: grabBool(text, /^\s*alertzone:\s*(\S+)/m, true),
    sendStatistics: grabBool(text, /^\s*statistics:\s*(\S+)/m, true),
    sqliteEnable: grabBool(text, /sqlite:\s*[\s\S]*?enable:\s*(\S+)/m, false),
    logVerbosity: grabString(text, /^\s*verbosity:\s*([^\s#]+)/m, "info"),
  };
}

/** config.yml を生成する。重要な注意書きは必ず残す（実機で踏んだ罠なので） */
export function buildSkylensConfig(c: SkylensConfig): string {
  const altitudeHae = Math.round((c.elevationM + c.geoidSeparationM) * 10) / 10;
  const b = (v: boolean) => (v ? "true" : "false");
  return `# SkyLens 受信ノード設定 — FEELDSCOPE が生成（手で編集した内容は保存時に失われます）
#
# ★重要★ station.position は「復号そのもの」に使われる。不正確だと一切デコードできない。
#          また、この座標から自動的にリージョン（日本なら JAPAN）が選択される。
#          起動後に必ず 'Demodulation Plan: JAPAN' を確認すること。
#
# ★重要★ output 配下の真偽値は true/false でしか効かない。1/0 は無言で既定値に戻る。
# ★重要★ MQTT を使わないなら mqtt: ブロックごと書かないこと。enable: 0 だけ書くと
#          output セクション全体が既定値に巻き戻り、UDP 宛先が 0.0.0.0 になる。
#
# feeldscope_geoid_separation: ${c.geoidSeparationM}
#   ↑ FEELDSCOPE 用のメモ。SkyLens の設定項目ではない。
#   station.position.altitude は楕円体高なので「標高 ${c.elevationM} m + ジオイド高 ${c.geoidSeparationM} m」で算出している。

station:
  id: ${c.stationId}
  position:
    latitude: ${c.latitude}
    longitude: ${c.longitude}
    # ★楕円体高 [m]。標高ではない（標高 ${c.elevationM} m + ジオイド高 ${c.geoidSeparationM} m）
    altitude: ${altitudeHae}

demodulation:
  # region: は書かない。station.position から自動で選択される
  sample_rate: ${c.sampleRate}
  gain: ${c.gain}                 # 0 = AGC（自動）
  ppm_correction: ${c.ppmCorrection}
  bias_t: ${b(c.biasT)}
  print_performance: false

output:
  send:
    heartbeat: ${b(c.sendHeartbeat)}
    traffic: ${b(c.sendTraffic)}
    alertzone: ${b(c.sendAlertzone)}
    statistics: ${b(c.sendStatistics)}
  udp:
    enable: ${b(c.udpEnable)}
    address: ${c.udpAddress}
    port: ${c.udpPort}
  tcp:
    enable: ${b(c.tcpEnable)}
    port: ${c.tcpPort}
  stdout:
    enable: false
  sqlite:
    enable: ${b(c.sqliteEnable)}

monitoring:
  enable: 1
  port: ${c.monitoringPort}

log:
  folder: ${SKYLENS_DIR}/logs
  verbosity: ${c.logVerbosity}

license:
  file: ${SKYLENS_LICENSE}
`;
}

/** root 権限が要るファイルへシェルを介さずに書き込む */
async function writeRootFile(target: string, content: string): Promise<void> {
  const tmp = `/tmp/feeldscope-skylens-${process.pid}-${Math.random().toString(36).slice(2)}`;
  await writeFile(tmp, content, { mode: 0o644 });
  try {
    await execAsync(`sudo -n cp ${tmp} ${target}`);
  } finally {
    await execAsync(`sudo -n rm -f ${tmp}`).catch(() => {});
  }
}

/**
 * 局位置を OGN 側にも反映する。受信機は 1 台なので、座標が食い違うと
 * どちらのモードで動いているかによって地図の受信機位置がずれてしまう。
 */
export async function applySharedPositionToOgn(lat: number, lon: number, elevationM: number): Promise<void> {
  for (const p of RTLSDR_OGN_CONF_PATHS) {
    let text: string;
    try {
      text = await readFile(p, "utf-8");
    } catch {
      continue;
    }
    const updated = text
      .replace(/(Latitude\s*=\s*)([+\-\d.]+)/, `$1${lat}`)
      .replace(/(Longitude\s*=\s*)([+\-\d.]+)/, `$1${lon}`)
      .replace(/(Altitude\s*=\s*)([+\-\d.]+)/, `$1${Math.round(elevationM)}`);
    if (updated !== text) await writeRootFile(p, updated);
  }
  try {
    let recv = await readFile(OGN_RECEIVER_CONF_PATH, "utf-8");
    if (recv) {
      recv = recv.replace(/^Latitude=".*"/m, `Latitude="${lat}"`);
      recv = recv.replace(/^Longitude=".*"/m, `Longitude="${lon}"`);
      recv = recv.replace(/^#?\s*Altitude=".*"/m, `Altitude="${Math.round(elevationM)}"`);
      await writeRootFile(OGN_RECEIVER_CONF_PATH, recv);
    }
  } catch { /* OGN-receiver.conf が無い端末もある */ }
}

/** SkyLens 側にだけ座標を反映する（OGN 設定画面から呼ばれる） */
export async function applySharedPositionToSkylens(lat: number, lon: number, elevationM: number): Promise<void> {
  if (!existsSync(SKYLENS_CONFIG)) return;
  const current = await readSkylensConfig();
  const next = { ...current, latitude: lat, longitude: lon, elevationM };
  await writeRootFile(SKYLENS_CONFIG, buildSkylensConfig(next));
}

export async function isActive(service: string): Promise<boolean> {
  try {
    const { stdout } = await execAsync(`systemctl is-active ${service}`);
    return stdout.trim() === "active";
  } catch {
    return false;
  }
}

/** Prometheus エンドポイントから実際に採用されている値を読む */
export async function getSkylensStatus() {
  const available = existsSync(`${SKYLENS_DIR}/skylens`);
  const licensed = existsSync(SKYLENS_LICENSE);
  const [serviceActive, bridgeActive, uploaderActive] = await Promise.all([
    isActive("skylens"),
    isActive("skylens-mqtt"),
    isActive("skylens-aprs"),
  ]);

  const info: Record<string, string> = {};
  const packets: Record<string, number> = {};
  let online = false;
  try {
    const cfg = await readSkylensConfig();
    const { stdout } = await execAsync(
      `curl -s --max-time 3 http://127.0.0.1:${cfg.monitoringPort}/metrics`
    );
    if (stdout.trim()) {
      online = true;
      for (const line of stdout.split("\n")) {
        const mi = line.match(/^skylens_station_total_info\{([^=]+)="([^"]*)"\}/);
        if (mi) { info[mi[1]] = mi[2]; continue; }
        const mp = line.match(/^skylens_received_packets_total\{stage="([^"]+)"\}\s+([0-9.]+)/);
        if (mp) packets[mp[1]] = Math.round(parseFloat(mp[2]));
      }
    }
  } catch { /* 停止中 */ }

  return {
    available,
    licensed,
    online,
    serviceActive,
    bridgeActive,
    uploaderActive,
    version: info["version"] || undefined,
    buildDate: info["build_date"] || undefined,
    instanceId: info["instance_id"] || undefined,
    licenseType: info["license_type"] || undefined,
    licenseExpiration: info["license_expiration"] || undefined,
    binaryExpiration: info["skylens_expiration"] || undefined,
    demodulationPlan: info["sdr_demodulation_plan"] || undefined,
    liveGain: info["sdr_gain_db"] || undefined,
    liveSampleRate: info["sdr_sampling_rate_per_second"] || undefined,
    liveSerial: info["sdr_serial"] || undefined,
    preambles: packets["preamble"],
    decoded: packets["decoded"],
    invalid: packets["invalid"],
  };
}

export function validateSkylensConfig(c: SkylensConfig): void {
  if (!/^[A-Za-z0-9_-]{1,33}$/.test(c.stationId)) {
    throw new Error("局IDは英数字・ハイフン・アンダースコア33文字以内である必要があります");
  }
  if (!(c.latitude >= -90 && c.latitude <= 90)) throw new Error("緯度は -90〜90 の範囲です");
  if (!(c.longitude >= -180 && c.longitude <= 180)) throw new Error("経度は -180〜180 の範囲です");
  if (!(c.elevationM >= -500 && c.elevationM <= 9000)) throw new Error("標高は -500〜9000 m の範囲です");
  if (!(c.geoidSeparationM >= -120 && c.geoidSeparationM <= 120)) {
    throw new Error("ジオイド高は -120〜120 m の範囲です");
  }
  if (!(c.sampleRate >= 1000000 && c.sampleRate <= 3200000)) {
    throw new Error("サンプルレートは 1,000,000〜3,200,000 S/s の範囲です（推奨 1.6M〜2.0M）");
  }
  if (!(c.gain >= 0 && c.gain <= 50)) throw new Error("ゲインは 0〜50 dB の範囲です（0 = AGC）");
  if (!(c.ppmCorrection >= -200 && c.ppmCorrection <= 200)) {
    throw new Error("周波数補正は -200〜200 ppm の範囲です");
  }
  for (const [label, port] of [["UDP", c.udpPort], ["TCP", c.tcpPort], ["監視", c.monitoringPort]] as const) {
    if (!(Number.isInteger(port) && port >= 1 && port <= 65535)) {
      throw new Error(`${label}ポートは 1〜65535 の整数です`);
    }
  }
  if (new Set([c.udpPort, c.tcpPort, c.monitoringPort]).size !== 3) {
    throw new Error("UDP・TCP・監視のポートは互いに異なる必要があります");
  }
  if (!/^(\d{1,3}\.){3}\d{1,3}$/.test(c.udpAddress)) {
    throw new Error("UDP 送信先は IPv4 アドレスで指定してください");
  }
  if (!c.sendTraffic) {
    throw new Error("traffic の送信を止めると地図に機体が出ません。有効のままにしてください");
  }
  if (!c.udpEnable) {
    throw new Error("UDP 出力を止めると地図に機体が出ません。有効のままにしてください");
  }
  if (!["error", "warn", "info", "debug", "trace"].includes(c.logVerbosity)) {
    throw new Error("ログ詳細度が不正です");
  }
}


/** 設定ファイルを書き出す（局位置は OGN 側にも反映する） */
export async function writeSkylensConfigFile(c: SkylensConfig): Promise<void> {
  await writeRootFile(SKYLENS_CONFIG, buildSkylensConfig(c));
}

/**
 * 稼働中なら SkyLens とブリッジを再起動する。
 * ブリッジも局位置を保持しているので、本体だけ再起動すると距離計算がずれる。
 */
export async function restartSkylens(): Promise<boolean> {
  let restarted = false;
  if (await isActive("skylens")) {
    await execAsync("sudo -n systemctl restart skylens", { timeout: 60_000 });
    restarted = true;
  }
  if (await isActive("skylens-mqtt")) {
    await execAsync("sudo -n systemctl restart skylens-mqtt", { timeout: 60_000 });
  }
  return restarted;
}
