import { NextResponse } from "next/server";
import { access, constants, readFile, rename, unlink, writeFile } from "fs/promises";
import { run } from "@/lib/run";

// /boot/rtlsdr-ogn.conf が正本。init.d は起動のたびにこれを /home/pi へ複製するので、
// /boot に書けていないと再起動で元に戻る。両方に書き、両方を確認する。
const RTLSDR_OGN_CONF_PATHS = ["/home/pi/rtlsdr-ogn.conf", "/boot/rtlsdr-ogn.conf"];
const RTLSDR_OGN_CONF_AUTHORITY = "/boot/rtlsdr-ogn.conf";
const OGN_RECEIVER_CONF_PATH = "/boot/OGN-receiver.conf";

/** 受信機を再起動する手段。上から順に試す（イメージによって作りが違う）。
 *  シェルを通さないので、要素はそのまま実行ファイルと引数になる。 */
const RESTART_COMMANDS: string[][] = [
  ["sudo", "-n", "/etc/init.d/rtlsdr-ogn", "restart"],
  ["sudo", "-n", "service", "rtlsdr-ogn", "restart"],
  ["sudo", "-n", "systemctl", "restart", "rtlsdr-ogn"],
];

/** 保存の各段階の結果。画面にそのまま出して、どこで失敗したか分かるようにする */
export interface StepResult {
  label: string;
  ok: boolean;
  detail?: string;
  error?: string;
}

export interface FileCheck {
  path: string;
  authority: boolean;
  exists: boolean;
  latitude?: number;
  longitude?: number;
  altitude?: number;
  receiverName?: string;
  matches?: boolean;
  /** 所有者とパーミッション。書き込めない理由を追えるように出す */
  perms?: string;
  error?: string;
}

export interface SaveReport {
  steps: StepResult[];
  files: FileCheck[];
  live?: FileCheck;
  verified: boolean;
}

interface OgnConfig {
  // From rtlsdr-ogn.conf (runtime)
  receiverName: string;        // APRS.Call
  latitude: number;            // Position.Latitude
  longitude: number;           // Position.Longitude
  altitude: number;            // Position.Altitude
  freqCorr: number;            // RF.FreqCorr
  httpPort: number;            // HTTP.Port
  // AGC / demodulator (added v1.1.23)
  gain: number;                // RF.OGN.Gain (initial value, OGN auto-steps from here)
  minNoise: number;            // RF.OGN.MinNoise (target noise floor)
  maxNoise: number;            // RF.OGN.MaxNoise (saturation guard)
  detectSNR: number;           // Demodulator.DetectSNR (decode threshold)
  // From /boot/OGN-receiver.conf (boot config / install)
  enableBias: boolean;         // enableBias="1"
  ognBinaryUrl: string;        // OGNBINARYURL
  enableCoreOGNTeamRemoteAdmin: boolean; // EnableCoreOGNTeamRemoteAdmin="true"
}

interface OgnStatus {
  online: boolean;
  software?: string;
  hostname?: string;
  cpuLoad?: string;
  cpuTemp?: string;
  ramFree?: string;
  ntpError?: string;
  ntpFreqCorr?: string;
  rtlsdrName?: string;
  rtlsdrTuner?: string;
  rtlsdrSerial?: string;
  centerFreq?: string;
  sampleRate?: string;
  freqCorrLive?: string;
  freqPlan?: string;
  ognGain?: string;
  noise?: string;
  liveTime?: string;
  // Decoder side (from port 8083)
  detectSNR?: string;
  aircraftsLast12h?: string;
  aircraftsLastHour?: string;
  aircraftsLastMinute?: string;
  positionsLastMinute?: string;
}

async function readRtlsdrConf(): Promise<string> {
  for (const p of RTLSDR_OGN_CONF_PATHS) {
    try {
      return await readFile(p, "utf-8");
    } catch { /* try next */ }
  }
  return "";
}

async function readReceiverConf(): Promise<string> {
  try {
    return await readFile(OGN_RECEIVER_CONF_PATH, "utf-8");
  } catch {
    return "";
  }
}

/** 設定ファイルから読んだポート番号を、そのまま外部へ渡さないよう正規化する */
function rfPort(port: number): number {
  const n = Math.trunc(Number(port));
  return Number.isFinite(n) && n > 0 && n < 65536 ? n : 8082;
}

/** デコーダ側のポート（RF ポート + 1 が慣例） */
function decodePort(port: number): number {
  return rfPort(port) + 1;
}

/** 受信機の状態ページを読む。ローカルの HTTP なのでシェルは介さない */
async function fetchLocalPage(port: number): Promise<string> {
  const { stdout } = await run(
    "curl",
    ["-s", "--max-time", "3", `http://localhost:${rfPort(port)}/`],
    { timeout: 8_000 },
  );
  return stdout;
}

function errMsg(e: unknown): string {
  if (e && typeof e === "object") {
    const o = e as { stderr?: string; message?: string };
    const t = (o.stderr || o.message || "").toString().trim();
    if (t) return t.split("\n")[0].slice(0, 200);
  }
  return String(e).slice(0, 200);
}

/**
 * 設定ファイルを置き換える。権限に応じて手段を変え、全部だめなら理由をまとめて投げる。
 *  1. そのまま書く（ファイルの所有者がこのプロセスなら通る）
 *  2. 同じディレクトリに作って置き換える（ファイルが root 所有でも、ディレクトリに
 *     書ければ差し替えられる）
 *  3. sudo で置く（/boot など、ディレクトリごと root のとき）
 */
async function writeConfFile(target: string, content: string): Promise<string> {
  const tried: string[] = [];
  try {
    await writeFile(target, content);
    return "直接書き込み";
  } catch (e) { tried.push(`直接書き込み: ${errMsg(e)}`); }

  const side = `${target}.feeldscope-new`;
  try {
    await writeFile(side, content);
    await rename(side, target);
    return "同ディレクトリで差し替え";
  } catch (e) {
    tried.push(`差し替え: ${errMsg(e)}`);
    await unlink(side).catch(() => {});
  }

  const tmp = `/tmp/feeldscope-ogn-${process.pid}-${Date.now()}.conf`;
  try {
    await writeFile(tmp, content);
    await run("sudo", ["-n", "cp", tmp, target]);
    return "sudo で書き込み";
  } catch (e) {
    tried.push(`sudo: ${errMsg(e)}`);
  } finally {
    await unlink(tmp).catch(() => {});
  }

  throw new Error(tried.join(" / "));
}

function extractField(content: string, regex: RegExp, fallback: string = ""): string {
  const m = content.match(regex);
  return m ? m[1].trim() : fallback;
}

async function getOgnConfig(): Promise<OgnConfig> {
  const rtl = await readRtlsdrConf();
  const recv = await readReceiverConf();

  return {
    receiverName: extractField(rtl, /Call\s*=\s*"([^"]*)"/),
    latitude: parseFloat(extractField(rtl, /Latitude\s*=\s*([0-9.\-]+)/, "0")),
    longitude: parseFloat(extractField(rtl, /Longitude\s*=\s*([0-9.\-]+)/, "0")),
    altitude: parseFloat(extractField(rtl, /Altitude\s*=\s*([0-9.\-]+)/, "0")),
    freqCorr: parseFloat(extractField(rtl, /FreqCorr\s*=\s*([0-9.\-]+)\s*;/, "0")),
    httpPort: parseInt(extractField(rtl, /HTTP:\s*\{\s*Port\s*=\s*(\d+)/, "8082"), 10),
    gain: parseFloat(extractField(rtl, /OGN:[\s\S]*?Gain\s*=\s*([0-9.\-]+)/, "7.7")),
    minNoise: parseFloat(extractField(rtl, /MinNoise\s*=\s*([0-9.\-]+)/, "5.0")),
    maxNoise: parseFloat(extractField(rtl, /MaxNoise\s*=\s*([0-9.\-]+)/, "10.0")),
    detectSNR: parseFloat(extractField(rtl, /DetectSNR\s*=\s*([0-9.\-]+)/, "3.0")),
    enableBias: /^enableBias\s*=\s*"1"/m.test(recv),
    ognBinaryUrl: extractField(recv, /OGNBINARYURL\s*=\s*"([^"]*)"/),
    enableCoreOGNTeamRemoteAdmin: /^EnableCoreOGNTeamRemoteAdmin\s*=\s*"true"/mi.test(recv),
  };
}

/** Build a fresh rtlsdr-ogn.conf from config (Japan FLARM optimized, no GSM) */
function buildRtlsdrConf(c: OgnConfig): string {
  return `RF:
{ FreqPlan   = 7;        # 7 = Japan (922.4 MHz FLARM band, 50 kHz x 3 ch)
  FreqCorr   = ${c.freqCorr};
  SampleRate = 2.0;

  OGN:
  { GainMode = 0;          # OGN-RF internal noise-window AGC steps from here
    Gain     = ${c.gain};        # initial gain (dB) — AGC auto-adjusts
    MinNoise = ${c.minNoise};        # AGC raises gain until measured noise reaches this
    MaxNoise = ${c.maxNoise};       # AGC lowers gain if noise exceeds this
  };
};

Demodulator:
{ DetectSNR  = ${c.detectSNR};        # SNR threshold for FLARM packet decode
  ScanMargin = 80.0;     # cover 3 Japan FLARM channels (922.351 / .402 / .449)
};

Position:
{ Latitude   =   ${c.latitude};
  Longitude  =   ${c.longitude};
  Altitude   =        ${c.altitude};
};

APRS:
{ Call = "${c.receiverName}";
};

HTTP:
{ Port = ${c.httpPort};
};
`;
}

/** 所有者・パーミッションと、このプロセスから書けるかどうか */
async function permsOf(path: string): Promise<string | undefined> {
  let owner = "";
  try {
    const { stdout } = await run("stat", ["-c", "%U:%G %a", path]);
    owner = stdout.trim();
  } catch {
    return undefined;
  }
  let writable = "not-writable";
  try {
    await access(path, constants.W_OK);
    writable = "writable";
  } catch { /* 書けない */ }
  return `${owner} / ${writable}`;
}

/** 1つの設定ファイルを読んで、期待した値になっているか調べる */
async function checkConfFile(path: string, expect?: OgnConfig): Promise<FileCheck> {
  const out: FileCheck = { path, authority: path === RTLSDR_OGN_CONF_AUTHORITY, exists: false };
  let text = "";
  try {
    text = await readFile(path, "utf-8");
    out.exists = true;
  } catch (e) {
    out.error = errMsg(e);
    return out;
  }
  out.latitude = parseFloat(extractField(text, /Latitude\s*=\s*([0-9.\-]+)/, "NaN"));
  out.longitude = parseFloat(extractField(text, /Longitude\s*=\s*([0-9.\-]+)/, "NaN"));
  out.altitude = parseFloat(extractField(text, /Altitude\s*=\s*([0-9.\-]+)/, "NaN"));
  out.receiverName = extractField(text, /Call\s*=\s*"([^"]*)"/);
  out.perms = await permsOf(path);
  if (expect) out.matches = sameAs(out, expect);
  return out;
}

function near(a: number | undefined, b: number, tol = 1e-9): boolean {
  return typeof a === "number" && Number.isFinite(a) && Math.abs(a - b) <= tol;
}

function sameAs(f: FileCheck, expect: OgnConfig): boolean {
  return (
    near(f.latitude, expect.latitude) &&
    near(f.longitude, expect.longitude) &&
    near(f.altitude, expect.altitude) &&
    f.receiverName === expect.receiverName
  );
}

/** 受信機が実際に使っている位置。デコーダの状態ページ（8083）が持っている */
async function checkLivePosition(httpPort: number, expect?: OgnConfig): Promise<FileCheck> {
  const port = decodePort(httpPort);
  const out: FileCheck = {
    path: `受信機が使用中の値（localhost:${port}）`,
    authority: false,
    exists: false,
  };
  try {
    const stdout = await fetchLocalPage(port);
    if (!stdout) throw new Error("デコーダの状態ページに接続できません");
    out.exists = true;
    const lat = extractStatusField(stdout, "Position.Latitude");
    const lon = extractStatusField(stdout, "Position.Longitude");
    const alt = extractStatusField(stdout, "Position.Altitude");
    out.latitude = lat ? parseFloat(lat) : undefined;
    out.longitude = lon ? parseFloat(lon) : undefined;
    out.altitude = alt ? parseFloat(alt) : undefined;
    if (expect) {
      // 状態ページの表示は小数点以下4〜5桁に丸められるので、緩めに比べる
      out.matches =
        near(out.latitude, expect.latitude, 1e-3) &&
        near(out.longitude, expect.longitude, 1e-3) &&
        near(out.altitude, expect.altitude, 1.5);
    }
  } catch (e) {
    out.error = errMsg(e);
  }
  return out;
}

/** /boot/OGN-receiver.conf（再インストール時に引き継がれる元データ）を確認する */
async function checkReceiverConf(expect?: OgnConfig): Promise<FileCheck> {
  const out: FileCheck = { path: OGN_RECEIVER_CONF_PATH, authority: false, exists: false };
  let text = "";
  try {
    text = await readFile(OGN_RECEIVER_CONF_PATH, "utf-8");
    out.exists = true;
  } catch (e) {
    out.error = errMsg(e);
    return out;
  }
  out.latitude = parseFloat(extractField(text, /^Latitude\s*=\s*"([0-9.\-]+)"/m, "NaN"));
  out.longitude = parseFloat(extractField(text, /^Longitude\s*=\s*"([0-9.\-]+)"/m, "NaN"));
  out.altitude = parseFloat(extractField(text, /^#?\s*Altitude\s*=\s*"([0-9.\-]+)"/m, "NaN"));
  out.receiverName = extractField(text, /^ReceiverName\s*=\s*"([^"]*)"/m);
  out.perms = await permsOf(OGN_RECEIVER_CONF_PATH);
  if (expect) out.matches = sameAs(out, expect);
  return out;
}

/** 保存せずに、今の設定がどこまで行き渡っているかを調べる */
async function verifyOgnConfig(expect?: OgnConfig): Promise<SaveReport> {
  const steps: StepResult[] = [];
  try {
    await run("sudo", ["-n", "true"]);
    steps.push({ label: "sudo（パスワード無しで実行できるか）", ok: true });
  } catch (e) {
    steps.push({
      label: "sudo（パスワード無しで実行できるか）",
      ok: false,
      error: `${errMsg(e)} — 設定ファイルの書き込みと受信機の再起動ができません`,
    });
  }

  const target = expect ?? (await getOgnConfig());
  const files: FileCheck[] = [];
  for (const path of RTLSDR_OGN_CONF_PATHS) files.push(await checkConfFile(path, target));
  files.push(await checkReceiverConf(target));
  const live = await checkLivePosition(target.httpPort || 8082, target);

  const authority = files.find((f) => f.authority);
  const verified = authority?.matches === true && files.every((f) => f.matches !== false);
  return { steps, files, live, verified };
}

/** 行があれば置き換え、無ければ足す。置き換えられず黙って消えるのを防ぐ */
function setConfLine(text: string, key: string, value: string): string {
  const re = new RegExp(`^#?\\s*${key}\\s*=.*$`, "mi");
  const line = `${key}="${value}"`;
  // 置換文字列の $& などを展開させないため、関数で返す
  if (re.test(text)) return text.replace(re, () => line);
  return (text === "" || text.endsWith("\n") ? text : text + "\n") + line + "\n";
}

async function saveOgnConfig(c: OgnConfig): Promise<SaveReport> {
  // Validate
  if (!/^[A-Z0-9]{1,9}$/i.test(c.receiverName || "")) {
    throw new Error("Receiver Name は英数字9文字以内である必要があります");
  }
  if (!Number.isFinite(c.latitude) || c.latitude < -90 || c.latitude > 90) {
    throw new Error("緯度は -90〜90 の範囲です");
  }
  if (!Number.isFinite(c.longitude) || c.longitude < -180 || c.longitude > 180) {
    throw new Error("経度は -180〜180 の範囲です");
  }
  if (!Number.isFinite(c.altitude) || c.altitude < -500 || c.altitude > 9000) {
    throw new Error("高度は -500〜9000m の範囲です");
  }
  if (c.gain < 0 || c.gain > 50) throw new Error("Initial Gain は 0〜50 dB の範囲です");
  if (c.minNoise < 0 || c.minNoise > 30) throw new Error("MinNoise は 0〜30 dB の範囲です");
  if (c.maxNoise <= c.minNoise || c.maxNoise > 40) throw new Error("MaxNoise は MinNoise より大きく 40 以下である必要があります");
  if (c.detectSNR < 1 || c.detectSNR > 20) throw new Error("DetectSNR は 1〜20 dB の範囲です");

  const steps: StepResult[] = [];
  const conf = buildRtlsdrConf(c);

  // ── 設定ファイルを書く ──
  // 失敗を黙って捨てない。どのファイルにどの手段で書けたかを残す。
  let wroteAuthority = false;
  for (const path of RTLSDR_OGN_CONF_PATHS) {
    try {
      const method = await writeConfFile(path, conf);
      steps.push({ label: `書き込み ${path}`, ok: true, detail: method });
      if (path === RTLSDR_OGN_CONF_AUTHORITY) wroteAuthority = true;
    } catch (e) {
      steps.push({ label: `書き込み ${path}`, ok: false, error: errMsg(e) });
    }
  }

  // ── 再インストールでも消えないよう /boot/OGN-receiver.conf も更新する ──
  try {
    const recv = await readReceiverConf();
    if (!recv) throw new Error("ファイルが読めません");
    let next = recv;
    next = setConfLine(next, "ReceiverName", c.receiverName);
    next = setConfLine(next, "Latitude", String(c.latitude));
    next = setConfLine(next, "Longitude", String(c.longitude));
    next = setConfLine(next, "Altitude", String(c.altitude));
    next = setConfLine(next, "FreqCorr", String(c.freqCorr));
    next = setConfLine(next, "enableBias", c.enableBias ? "1" : "0");
    if (c.ognBinaryUrl) next = setConfLine(next, "OGNBINARYURL", c.ognBinaryUrl);
    next = setConfLine(next, "EnableCoreOGNTeamRemoteAdmin", c.enableCoreOGNTeamRemoteAdmin ? "true" : "false");
    const method = await writeConfFile(OGN_RECEIVER_CONF_PATH, next);
    steps.push({ label: `書き込み ${OGN_RECEIVER_CONF_PATH}`, ok: true, detail: method });
  } catch (e) {
    steps.push({ label: `書き込み ${OGN_RECEIVER_CONF_PATH}`, ok: false, error: errMsg(e) });
  }

  // ── 受信機を再起動して反映する ──
  // 正本に書けていないなら、再起動しても元の設定に戻るだけなので行わない。
  if (wroteAuthority) {
    let restarted = false;
    const errors: string[] = [];
    for (const [cmd, ...args] of RESTART_COMMANDS) {
      try {
        await run(cmd, args);
        steps.push({ label: "受信機の再起動", ok: true, detail: [cmd, ...args].join(" ") });
        restarted = true;
        break;
      } catch (e) {
        errors.push(`${[cmd, ...args].join(" ")}: ${errMsg(e)}`);
      }
    }
    if (!restarted) steps.push({ label: "受信機の再起動", ok: false, error: errors.join(" / ") });

    // OGN 設定マネージャは起動のたびに wpa_supplicant.conf へ network ブロックを
    // 追記するため、restart 直後に重複を畳んでおく（詳細は feeldscope-wpa-dedupe.sh）
    await run("sudo", ["-n", "/usr/local/sbin/feeldscope-wpa-dedupe"]).catch(() => {});
  } else {
    steps.push({
      label: "受信機の再起動",
      ok: false,
      error: `${RTLSDR_OGN_CONF_AUTHORITY} に書けていないため、再起動しても元の設定に戻ります。再起動は行いませんでした`,
    });
  }

  // ── 本当に書けたか、読み戻して確かめる ──
  const report = await verifyOgnConfig(c);
  report.steps = [...steps, ...report.steps];
  return report;
}

function extractStatusField(html: string, label: string): string | undefined {
  // Match: <td>{label}</td><td align=right><b>{value}</b></td>
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`<td>${escaped}</td>\\s*<td[^>]*><b>([^<]*)</b>`, "i");
  const m = html.match(re);
  if (!m) return undefined;
  // Strip HTML entities like &#x2103;
  return m[1].replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16))).trim();
}

async function getOgnStatus(httpPort: number): Promise<OgnStatus> {
  try {
    const stdout = await fetchLocalPage(httpPort);
    const html = stdout || "";
    if (!html) return { online: false };

    const softwareMatch = html.match(/RTLSDR OGN RF processor ([^\/]+)\/([^<]+)/);
    const base: OgnStatus = {
      online: true,
      software: softwareMatch ? `${softwareMatch[1].trim()} (${softwareMatch[2].trim()})` : undefined,
      hostname: extractStatusField(html, "Host name"),
      cpuLoad: extractStatusField(html, "CPU load"),
      cpuTemp: extractStatusField(html, "CPU temperature"),
      ramFree: extractStatusField(html, "RAM [free/total]"),
      ntpError: extractStatusField(html, "NTP est. error"),
      ntpFreqCorr: extractStatusField(html, "NTP freq. corr."),
      rtlsdrName: extractStatusField(html, "Name"),
      rtlsdrTuner: extractStatusField(html, "Tuner type"),
      rtlsdrSerial: extractStatusField(html, "Serial"),
      centerFreq: extractStatusField(html, "Center frequency"),
      sampleRate: extractStatusField(html, "Sample rate"),
      freqCorrLive: extractStatusField(html, "Frequency correction"),
      freqPlan: extractStatusField(html, "RF.FreqPlan"),
      ognGain: extractStatusField(html, "RF.OGN.Gain"),
      noise: extractStatusField(html, "Measured noise"),
      liveTime: extractStatusField(html, "Live Time"),
    };

    // Also fetch decoder stats from port 8083 (rf port + 1 by convention)
    try {
      const dec = await fetchLocalPage(decodePort(httpPort));
      if (dec) {
        base.detectSNR = extractStatusField(dec, "Demodulator.DetectSNR");
        base.aircraftsLast12h = extractStatusField(dec, "Aircrafts received over last 12 hours");
        base.aircraftsLastHour = extractStatusField(dec, "Aircrafts received over last hour");
        base.aircraftsLastMinute = extractStatusField(dec, "Aircrafts received over last minute");
        base.positionsLastMinute = extractStatusField(dec, "Positions received over last minute");
      }
    } catch { /* decoder unreachable, leave undefined */ }

    return base;
  } catch {
    return { online: false };
  }
}

// GET /api/ogn — return config + live status
export async function GET() {
  const config = await getOgnConfig();
  const status = await getOgnStatus(config.httpPort || 8082);
  return NextResponse.json({ config, status });
}

// POST /api/ogn — save config or restart receiver
export async function POST(request: Request) {
  const body = await request.json();
  const { action } = body;

  try {
    switch (action) {
      case "save": {
        const c: OgnConfig = body.config;
        const report = await saveOgnConfig(c);
        // 書けたつもりで書けていない、を無くす。読み戻して一致したときだけ成功と言う。
        if (!report.verified) {
          const failed = report.steps.filter((x) => !x.ok).map((x) => `${x.label}: ${x.error}`);
          return NextResponse.json(
            {
              ok: false,
              error:
                "設定を保存できませんでした（読み戻した値が一致しません）。" +
                (failed.length ? ` ${failed.join(" / ")}` : ""),
              report,
            },
            { status: 500 },
          );
        }
        return NextResponse.json({
          ok: true,
          message: "OGN設定を保存し、受信機を再起動しました。書き込んだ内容は読み戻して確認済みです。AGCの再収束に約1分かかります。",
          report,
        });
      }
      case "verify": {
        // 保存せずに、設定がどこまで行き渡っているかだけを見る
        const report = await verifyOgnConfig(body.config as OgnConfig | undefined);
        return NextResponse.json({
          ok: true,
          message: report.verified
            ? "設定ファイルと受信機の値は一致しています。"
            : "一致しない箇所があります。下の一覧を確認してください。",
          report,
        });
      }
      case "restart": {
        const errors: string[] = [];
        for (const [cmd, ...args] of RESTART_COMMANDS) {
          const shown = [cmd, ...args].join(" ");
          try {
            await run(cmd, args);
            return NextResponse.json({ ok: true, message: `OGN受信機を再起動しました（${shown}）。` });
          } catch (e) {
            errors.push(`${shown}: ${errMsg(e)}`);
          }
        }
        throw new Error(`受信機を再起動できませんでした。${errors.join(" / ")}`);
      }
      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
