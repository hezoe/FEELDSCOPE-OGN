/**
 * OGN 設定画面(/api/ogn)から受け取った値の検査。
 *
 * 保存した値は rtlsdr-ogn.conf と /boot/OGN-receiver.conf に書かれ、後者は受信機の起動時に
 * root の bash が source する。値に `"` や `$(...)` を通すと root でコマンドが動くので
 * (セキュリティ点検 R-004)、受け取った JSON をそのまま使わず、ここで型・範囲・文字を
 * 確かめて、決まった項目だけの新しいオブジェクトに詰め直してから使う。
 */
import { assertHttpUrl } from "@/lib/run";

export interface OgnConfig {
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

/** 入力の誤り。API は 400 で返す */
export class OgnInputError extends Error {}

/** 数値の欄。文字列・NaN・Infinity は受け付けない(大小比較だけだと "7.7;…" が素通りする) */
function num(v: unknown, label: string, min: number, max: number, integer = false): number {
  if (typeof v !== "number" || !Number.isFinite(v)) throw new OgnInputError(`${label}は数値で入力してください`);
  if (integer && !Number.isInteger(v)) throw new OgnInputError(`${label}は整数で入力してください`);
  if (v < min || v > max) throw new OgnInputError(`${label}は ${min}〜${max} の範囲です`);
  return v;
}

/** 設定画面から届いた config を検査し、使ってよい形に詰め直す */
export function sanitizeOgnConfig(raw: unknown): OgnConfig {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new OgnInputError("設定の値がありません");
  const c = raw as Record<string, unknown>;

  const receiverName = typeof c.receiverName === "string" ? c.receiverName : "";
  if (!/^[A-Z0-9]{1,9}$/i.test(receiverName)) {
    throw new OgnInputError("Receiver Name は英数字9文字以内である必要があります");
  }
  const minNoise = num(c.minNoise, "MinNoise", 0, 30);
  const maxNoise = num(c.maxNoise, "MaxNoise", 0, 40);
  if (maxNoise <= minNoise) throw new OgnInputError("MaxNoise は MinNoise より大きく 40 以下である必要があります");

  let ognBinaryUrl = "";
  if (c.ognBinaryUrl !== undefined && c.ognBinaryUrl !== null && c.ognBinaryUrl !== "") {
    if (typeof c.ognBinaryUrl !== "string") throw new OgnInputError("OGN Binary URL は文字で入力してください");
    try {
      ognBinaryUrl = assertHttpUrl(c.ognBinaryUrl, "OGN Binary URL");
    } catch (e) {
      throw new OgnInputError(e instanceof Error ? e.message : String(e));
    }
  }

  return {
    receiverName,
    latitude: num(c.latitude, "緯度", -90, 90),
    longitude: num(c.longitude, "経度", -180, 180),
    altitude: num(c.altitude, "高度(m)", -500, 9000),
    freqCorr: num(c.freqCorr, "Freq Corr(ppm)", -200, 200),
    httpPort: num(c.httpPort, "HTTP Port", 1024, 65534, true),
    gain: num(c.gain, "Initial Gain", 0, 50),
    minNoise,
    maxNoise,
    detectSNR: num(c.detectSNR, "DetectSNR", 1, 20),
    enableBias: c.enableBias === true,
    ognBinaryUrl,
    enableCoreOGNTeamRemoteAdmin: c.enableCoreOGNTeamRemoteAdmin === true,
  };
}

/**
 * bash が source する `KEY="値"` の行に書いてよい値か。sanitizeOgnConfig を通した値なら
 * 必ず通るが、ほかの経路から呼ばれても差し込みにならないよう、書く直前にも確かめる(最後の防衛線)。
 * 二重引用符の中で意味を持つ " \ $ ` と、行を分ける改行などの制御文字を拒む。
 */
export function assertShellSafeValue(key: string, value: string): string {
  if (/["\\$`\x00-\x1f\x7f]/.test(value)) {
    throw new Error(`${key} に使えない文字(" \\ $ \` や改行など)が含まれているため、書き込みを中止しました`);
  }
  return value;
}
