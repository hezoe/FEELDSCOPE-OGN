import { NextResponse } from "next/server";
import { exec } from "child_process";
import { promisify } from "util";
import { readFile } from "fs/promises";

const execAsync = promisify(exec);

const RTLSDR_OGN_CONF_PATHS = ["/home/pi/rtlsdr-ogn.conf", "/boot/rtlsdr-ogn.conf"];
const RX_MODE_STATE = "/etc/rx-mode.state";
const UPLOAD_CONFIG_PATH = process.env.FEELDSCOPE_UPLOAD_CONFIG || "/home/pi/FEELDSCOPE/upload-config.json";

type RxMode = "ogn" | "skylens" | "history" | "stopped";

async function readSavedRxMode(): Promise<RxMode | null> {
  try {
    const v = (await readFile(RX_MODE_STATE, "utf-8")).trim();
    if (v === "ogn" || v === "skylens" || v === "history" || v === "stopped") return v;
  } catch { /* 未設定 */ }
  return null;
}

async function getUploadConfig() {
  try {
    const parsed = JSON.parse(await readFile(UPLOAD_CONFIG_PATH, "utf-8"));
    return {
      enabled: parsed.enabled === true,
      ogn_enabled: parsed.ogn_enabled === true,
      callsign: typeof parsed.callsign === "string" ? parsed.callsign : "",
      updated_at: typeof parsed.updated_at === "string" ? parsed.updated_at : null,
    };
  } catch {
    return { enabled: false, ogn_enabled: false, callsign: "", updated_at: null };
  }
}

/** SkyLens 本体の稼働情報。復調プラン等はブリッジが MQTT に載せている */
async function getSkylensProcess() {
  const [serviceActive, processAlive] = await Promise.all([
    isActive("skylens"),
    execAsync("pgrep -x skylens").then(() => true).catch(() => false),
  ]);
  let licenseUntil: string | null = null;
  try {
    const { stdout } = await execAsync("grep -a -o -m1 '20[0-9][0-9]-[0-9][0-9]-[0-9][0-9]' /home/pi/skylens/node.lic");
    licenseUntil = stdout.trim() || null;
  } catch { /* ライセンス未配置 */ }
  return { service_active: serviceActive, process_alive: processAlive, license_until: licenseUntil };
}

async function isActive(service: string): Promise<boolean> {
  try {
    const { stdout } = await execAsync(`systemctl is-active ${service}`);
    return stdout.trim() === "active";
  } catch {
    return false;
  }
}

async function isInitdActive(name: string): Promise<boolean> {
  // rtlsdr-ogn の init スクリプトの status はプロセス一覧を並べるだけで
  // "running" とは書かない。実プロセスの有無で判定する。
  if (name === "rtlsdr-ogn") {
    return execAsync("pgrep -x ogn-rf").then(() => true).catch(() => false);
  }
  try {
    const { stdout } = await execAsync(`/etc/init.d/${name} status 2>&1 | grep -i running || true`);
    return stdout.trim().length > 0;
  } catch {
    return false;
  }
}

async function getReceiverId(): Promise<string> {
  if (process.env.FEELDSCOPE_RECEIVER_ID) return process.env.FEELDSCOPE_RECEIVER_ID;
  try {
    const data = await readFile("/boot/OGN-receiver.conf", "utf-8");
    const m = data.match(/ReceiverName="([^"#]+)"/);
    if (m) return m[1];
  } catch { /* ignore */ }
  for (const p of RTLSDR_OGN_CONF_PATHS) {
    try {
      const data = await readFile(p, "utf-8");
      const m = data.match(/Call\s*=\s*"([^"]+)"/);
      if (m) return m[1];
    } catch { /* ignore */ }
  }
  return "OGNReceiver";
}

async function mqttGetRetained(topic: string): Promise<unknown> {
  try {
    const { stdout } = await execAsync(`mosquitto_sub -t '${topic}' -W 2 -C 1 2>/dev/null || true`);
    if (!stdout.trim()) return null;
    return JSON.parse(stdout);
  } catch {
    return null;
  }
}

async function getSystemSummary() {
  try {
    const [{ stdout: uptimeOut }, { stdout: loadOut }, { stdout: memOut }, { stdout: dfOut }, { stdout: tempOut }] = await Promise.all([
      execAsync("uptime -p").catch(() => ({ stdout: "" })),
      execAsync("cat /proc/loadavg").catch(() => ({ stdout: "" })),
      execAsync("free -m | awk '/^Mem:/ {print $2,$3,$7}'").catch(() => ({ stdout: "" })),
      execAsync("df -BM / | awk 'NR==2 {print $2,$3,$5}'").catch(() => ({ stdout: "" })),
      execAsync("cat /sys/class/thermal/thermal_zone0/temp 2>/dev/null").catch(() => ({ stdout: "" })),
    ]);

    const loadParts = loadOut.trim().split(/\s+/);
    const memParts = memOut.trim().split(/\s+/);
    const dfParts = dfOut.trim().split(/\s+/);
    const cpuTempC = tempOut.trim() ? parseInt(tempOut.trim(), 10) / 1000 : null;

    return {
      uptime: uptimeOut.trim().replace(/^up\s+/, ""),
      load: loadParts.length >= 3 ? `${loadParts[0]} / ${loadParts[1]} / ${loadParts[2]}` : "",
      cpu_temp_c: cpuTempC,
      ram_total_mb: memParts[0] ? parseInt(memParts[0], 10) : null,
      ram_used_mb: memParts[1] ? parseInt(memParts[1], 10) : null,
      ram_available_mb: memParts[2] ? parseInt(memParts[2], 10) : null,
      disk_total: dfParts[0] || "",
      disk_used: dfParts[1] || "",
      disk_used_pct: dfParts[2] || "",
    };
  } catch {
    return null;
  }
}

async function getOgnReceiverStatus() {
  try {
    const { stdout } = await execAsync(`curl -s --max-time 3 http://localhost:8082/`);
    if (!stdout) return { online: false };
    const get = (label: string): string | undefined => {
      const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const re = new RegExp(`<td>${escaped}</td>\\s*<td[^>]*><b>([^<]*)</b>`, "i");
      const m = stdout.match(re);
      return m ? m[1].replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16))).trim() : undefined;
    };
    const sw = stdout.match(/RTLSDR OGN RF processor ([^\/]+)\/([^<]+)/);
    return {
      online: true,
      software: sw ? `${sw[1].trim()} (${sw[2].trim()})` : undefined,
      cpu_temp: get("CPU temperature"),
      ntp_error: get("NTP est. error"),
      ntp_freq_corr: get("NTP freq. corr."),
      rtlsdr_name: get("Name"),
      rtlsdr_tuner: get("Tuner type"),
      center_freq: get("Center frequency"),
      freq_corr_live: get("Frequency correction"),
      freq_plan: get("RF.FreqPlan"),
      ogn_gain: get("RF.OGN.Gain"),
      noise: get("Measured noise"),
      live_time: get("Live Time"),
      // Decoder-side stats (port 8083)
      ...(await getDecoderStats()),
    };
  } catch {
    return { online: false };
  }
}

async function getDecoderStats() {
  try {
    const { stdout } = await execAsync(`curl -s --max-time 3 http://localhost:8083/`);
    if (!stdout) return {};
    const get = (label: string): string | undefined => {
      const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const re = new RegExp(`<td>${escaped}</td>\\s*<td[^>]*><b>([^<]*)</b>`, "i");
      const m = stdout.match(re);
      return m ? m[1].replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16))).trim() : undefined;
    };
    return {
      detect_snr: get("Demodulator.DetectSNR"),
      aircrafts_last_min: get("Aircrafts received over last minute"),
      aircrafts_last_hour: get("Aircrafts received over last hour"),
      positions_last_min: get("Positions received over last minute"),
    };
  } catch {
    return {};
  }
}

async function getServiceUptime(service: string): Promise<string | null> {
  try {
    const { stdout } = await execAsync(`systemctl show -p ActiveEnterTimestamp --value ${service}`);
    const ts = stdout.trim();
    if (!ts) return null;
    const enteredAt = new Date(ts).getTime();
    if (isNaN(enteredAt)) return null;
    const sec = Math.floor((Date.now() - enteredAt) / 1000);
    if (sec < 60) return `${sec}s`;
    if (sec < 3600) return `${Math.floor(sec / 60)}m ${sec % 60}s`;
    if (sec < 86400) return `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m`;
    return `${Math.floor(sec / 86400)}d ${Math.floor((sec % 86400) / 3600)}h`;
  } catch {
    return null;
  }
}

async function getFlightLogStats() {
  try {
    const { stdout } = await execAsync(`curl -s --max-time 2 http://localhost/api/flight-log`);
    const data = JSON.parse(stdout);
    const entries = data.entries || [];
    const flying = entries.filter((e: { landingTime: string | null }) => !e.landingTime).length;
    return { total: entries.length, flying, landed: entries.length - flying };
  } catch {
    return { total: 0, flying: 0, landed: 0 };
  }
}

interface AdsbStatusMqtt {
  url?: string;
  interval_sec?: number;
  last_attempt_utc?: string;
  last_fetch_ok?: boolean;
  last_error?: string | null;
  last_latency_ms?: number;
  poll_count?: number;
  success_count?: number;
  consecutive_failures?: number;
  aircraft_with_position?: number;
  aircraft_without_position?: number;
  aircraft_total?: number;
  started_at_utc?: string;
}

interface OgnReceiverStatusMqtt {
  online?: boolean;
  [key: string]: unknown;
}

export async function GET() {
  const receiverId = await getReceiverId();

  const [
    system,
    ognReceiver,
    adsbStatus,
    ognMqttStatus,
    aprsStatus,
    services,
    flightLogStats,
    savedMode,
    upload,
    skylensProcess,
  ] = await Promise.all([
    getSystemSummary(),
    getOgnReceiverStatus(),
    mqttGetRetained(`ogn/${receiverId}/adsb_status`) as Promise<AdsbStatusMqtt | null>,
    mqttGetRetained(`ogn/${receiverId}/status`) as Promise<OgnReceiverStatusMqtt | null>,
    mqttGetRetained(`ogn/${receiverId}/aprs_status`) as Promise<Record<string, unknown> | null>,
    Promise.all([
      isActive("mosquitto").then(active => ({ name: "mosquitto", active, uptime: null as string | null })),
      isActive("ogn-mqtt").then(async active => ({ name: "ogn-mqtt", active, uptime: active ? await getServiceUptime("ogn-mqtt") : null })),
      isActive("skylens").then(async active => ({ name: "skylens", active, uptime: active ? await getServiceUptime("skylens") : null })),
      isActive("skylens-mqtt").then(async active => ({ name: "skylens-mqtt", active, uptime: active ? await getServiceUptime("skylens-mqtt") : null })),
      isActive("skylens-aprs").then(async active => ({ name: "skylens-aprs", active, uptime: active ? await getServiceUptime("skylens-aprs") : null })),
      isActive("igc-simulator").then(async active => ({ name: "igc-simulator", active, uptime: active ? await getServiceUptime("igc-simulator") : null })),
      isActive("adsb-poller").then(async active => ({ name: "adsb-poller", active, uptime: active ? await getServiceUptime("adsb-poller") : null })),
      isActive("feeldscope-webapp").then(async active => ({ name: "feeldscope-webapp", active, uptime: active ? await getServiceUptime("feeldscope-webapp") : null })),
      isActive("avahi-daemon").then(active => ({ name: "avahi-daemon", active, uptime: null as string | null })),
      isInitdActive("rtlsdr-ogn").then(active => ({ name: "rtlsdr-ogn (init.d)", active, uptime: null as string | null })),
    ]),
    getFlightLogStats(),
    readSavedRxMode(),
    getUploadConfig(),
    getSkylensProcess(),
  ]);

  // サービス状態と retained を整合させる:
  //  - サービス inactive    → null（未設定/停止中）
  //  - active かつ retained 到着 → retained に service_active=true を付与
  //  - active かつ retained 未着 → 最小オブジェクト { service_active:true } で「起動中」を伝える
  const adsbActive = services.some(s => s.name === "adsb-poller" && s.active);
  const ognMqttActive = services.some(s => s.name === "ogn-mqtt" && s.active);

  const adsbStatusOut = !adsbActive
    ? null
    : adsbStatus
      ? { ...adsbStatus, service_active: true }
      : { service_active: true };

  const ognMqttStatusOut = !ognMqttActive
    ? null
    : ognMqttStatus
      ? { ...ognMqttStatus, service_active: true }
      : { service_active: true };

  // 実際に動いているサービスから現在のモードを決める（保存値より実態を優先）
  const skylensMqttActive = services.some(s => s.name === "skylens-mqtt" && s.active);
  const igcActive = services.some(s => s.name === "igc-simulator" && s.active);
  const rxMode: RxMode = igcActive ? "history"
    : skylensMqttActive ? "skylens"
    : ognMqttActive ? "ogn"
    : "stopped";

  // MQTT の受信機ステータスは、稼働中のブリッジ（OGN か SkyLens）が書いている
  const receiverStatus = (skylensMqttActive || ognMqttActive) ? ognMqttStatus : null;
  const receiverSource = (receiverStatus?.source as string | undefined)
    ?? (skylensMqttActive ? "skylens" : "ogn");

  // アップロードの実状態: OGN 受信中はデコーダの APRS 欄、
  // SkyLens 受信中は skylens-aprs が publish した aprs_status を見る
  const ognAprs = (receiverStatus?.aprs ?? null) as Record<string, unknown> | null;
  const uploadLive = rxMode === "skylens"
    ? {
        transport: "skylens-aprs",
        service_active: services.some(s => s.name === "skylens-aprs" && s.active),
        ...(aprsStatus ?? {}),
      }
    : rxMode === "ogn"
      ? {
          transport: "ogn-decode",
          service_active: ognMqttActive,
          connected: !!(ognAprs?.connected_to),
          connected_to: (ognAprs?.connected_to as string) || null,
          server: (ognAprs?.server as string) || null,
          callsign: (ognAprs?.call as string) || "",
          kb_sent: ognAprs?.kb_sent ?? null,
          beacon_interval_sec: ognAprs?.beacon_interval_sec ?? null,
          position_interval_sec: ognAprs?.position_interval_sec ?? null,
        }
      : { transport: null, service_active: false, connected: false };

  return NextResponse.json({
    receiver_id: receiverId,
    rx_mode: rxMode,
    saved_rx_mode: savedMode,
    receiver_source: receiverSource,
    upload: { config: upload, live: uploadLive },
    skylens: {
      ...skylensProcess,
      bridge_active: skylensMqttActive,
      status: skylensMqttActive ? receiverStatus : null,
    },
    system,
    ogn_receiver: ognReceiver,
    ogn_mqtt_status: ognMqttStatusOut,
    adsb_status: adsbStatusOut,
    services,
    flight_log: flightLogStats,
  });
}
