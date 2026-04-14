import { NextResponse } from "next/server";
import { exec } from "child_process";
import { promisify } from "util";
import { readFile, writeFile } from "fs/promises";

const execAsync = promisify(exec);

const RTLSDR_OGN_CONF_PATHS = ["/home/pi/rtlsdr-ogn.conf", "/boot/rtlsdr-ogn.conf"];
const OGN_RECEIVER_CONF_PATH = "/boot/OGN-receiver.conf";

interface OgnConfig {
  // From rtlsdr-ogn.conf (runtime)
  receiverName: string;        // APRS.Call
  latitude: number;            // Position.Latitude
  longitude: number;           // Position.Longitude
  altitude: number;            // Position.Altitude
  freqCorr: number;            // RF.FreqCorr
  gsmCenterFreq: number;       // RF.GSM.CenterFreq
  gsmGain: number;             // RF.GSM.Gain
  httpPort: number;            // HTTP.Port
  // From /boot/OGN-receiver.conf (boot config / install)
  enableBias: boolean;         // enableBias="1"
  ognBinaryUrl: string;        // OGNBINARYURL
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
    gsmCenterFreq: parseFloat(extractField(rtl, /CenterFreq\s*=\s*([0-9.]+)/, "922.4")),
    gsmGain: parseFloat(extractField(rtl, /GSM:[\s\S]*?Gain\s*=\s*([0-9.]+)/, "25")),
    httpPort: parseInt(extractField(rtl, /HTTP:\s*\{\s*Port\s*=\s*(\d+)/, "8082"), 10),
    enableBias: /^enableBias\s*=\s*"1"/m.test(recv),
    ognBinaryUrl: extractField(recv, /OGNBINARYURL\s*=\s*"([^"]*)"/),
  };
}

/** Build a fresh rtlsdr-ogn.conf from config */
function buildRtlsdrConf(c: OgnConfig): string {
  return `RF:
{
  FreqCorr = ${c.freqCorr};          # [ppm]      "big" R820T sticks have 40-80ppm correction factors, measure it with gsm_scan

  GSM:                     # for frequency calibration based on GSM signals
  { CenterFreq  = ${c.gsmCenterFreq};   # [MHz] find the best GSM frequency with gsm_scan
    Gain        = ${c.gsmGain};   # [dB]  RF input gain (beware that GSM signals are very strong !)
  } ;
} ;
Position:
{ Latitude   =   ${c.latitude}; # [deg] Antenna coordinates
  Longitude  =   ${c.longitude}; # [deg]
  Altitude   =        ${c.altitude}; # [m]   Altitude above sea leavel
} ;

APRS:
{ Call = "${c.receiverName}";     # APRS callsign (max. 9 characters)
} ;


HTTP:
{ Port = ${c.httpPort};
} ;
`;
}

async function saveOgnConfig(c: OgnConfig): Promise<void> {
  // Validate
  if (!/^[A-Z0-9]{1,9}$/i.test(c.receiverName)) {
    throw new Error("Receiver Name は英数字9文字以内である必要があります");
  }
  if (c.latitude < -90 || c.latitude > 90) throw new Error("緯度は -90〜90 の範囲です");
  if (c.longitude < -180 || c.longitude > 180) throw new Error("経度は -180〜180 の範囲です");

  const conf = buildRtlsdrConf(c);

  // Write rtlsdr-ogn.conf (write via sudo since /boot/ requires root)
  const tmpPath = "/tmp/rtlsdr-ogn.conf.new";
  await writeFile(tmpPath, conf);
  for (const p of RTLSDR_OGN_CONF_PATHS) {
    await execAsync(`sudo cp ${tmpPath} ${p}`).catch(() => {});
  }

  // Update /boot/OGN-receiver.conf for persistence across reinstalls
  try {
    let recv = await readReceiverConf();
    if (recv) {
      recv = recv.replace(/^ReceiverName=".*"/m, `ReceiverName="${c.receiverName}"`);
      recv = recv.replace(/^Latitude=".*"/m, `Latitude="${c.latitude}"`);
      recv = recv.replace(/^Longitude=".*"/m, `Longitude="${c.longitude}"`);
      recv = recv.replace(/^#?\s*Altitude=".*"/m, `Altitude="${c.altitude}"`);
      recv = recv.replace(/^FreqCorr=".*"/m, `FreqCorr="${c.freqCorr}"`);
      recv = recv.replace(/^GSMCenterFreq=".*"/m, `GSMCenterFreq="${c.gsmCenterFreq}"`);
      recv = recv.replace(/^#?\s*GSMGain=".*"/m, `GSMGain="${c.gsmGain}"`);
      recv = recv.replace(/^#?\s*enableBias=".*"/m, `enableBias="${c.enableBias ? "1" : "0"}"`);
      if (c.ognBinaryUrl) {
        recv = recv.replace(/^OGNBINARYURL=".*"/m, `OGNBINARYURL="${c.ognBinaryUrl}"`);
      }
      const tmp2 = "/tmp/OGN-receiver.conf.new";
      await writeFile(tmp2, recv);
      await execAsync(`sudo cp ${tmp2} ${OGN_RECEIVER_CONF_PATH}`);
    }
  } catch { /* ignore */ }

  // Restart rtlsdr-ogn (init.d) so changes take effect
  await execAsync("sudo /etc/init.d/rtlsdr-ogn restart").catch(() => {});
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
    const { stdout } = await execAsync(`curl -s --max-time 3 http://localhost:${httpPort}/`);
    const html = stdout || "";
    if (!html) return { online: false };

    const softwareMatch = html.match(/RTLSDR OGN RF processor ([^\/]+)\/([^<]+)/);
    return {
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
        await saveOgnConfig(c);
        return NextResponse.json({ ok: true, message: "OGN設定を保存し、受信機を再起動しました。" });
      }
      case "restart": {
        await execAsync("sudo /etc/init.d/rtlsdr-ogn restart");
        return NextResponse.json({ ok: true, message: "OGN受信機を再起動しました。" });
      }
      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
