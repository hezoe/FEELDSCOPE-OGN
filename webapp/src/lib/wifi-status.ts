/**
 * Wi-Fi の状態・設定・周辺のネットワーク(wpa_cli / wpa_supplicant.conf)を読み解く関数。
 * コマンドの実行は呼び出し側(api/system)。ここは文字列の解析だけ(副作用なし)。
 *
 * 背景(2026-10-16 Sekiyado1): 入力した SSID の大文字・小文字が実際の電波と違い、いつまでも接続できなかった。
 * 設定画面は「接続中の SSID」しか出していなかったので、保存した設定が消えたように見えていた。
 * → 保存済みの SSID と接続状態を分けて出し、周辺の SSID を一覧から選べるようにする。
 */

/** wpa_cli status の主な項目 */
export interface WpaStatus {
  state: string;     // COMPLETED / SCANNING / ASSOCIATING / 4WAY_HANDSHAKE / DISCONNECTED / INACTIVE / INTERFACE_DISABLED …
  ssid: string;      // 接続中(または接続しようとしている)の SSID
  ip: string;        // wlan0 の IPv4
  freq: number | null; // MHz
}

/** 周辺の Wi-Fi(同じ SSID の複数の電波は1つにまとめる) */
export interface WifiNetwork {
  ssid: string;
  signal: number;          // dBm(いちばん強い電波)
  bands: ("2.4GHz" | "5GHz")[];
  security: "OPEN" | "WEP" | "WPA" | "WPA2" | "WPA2/WPA3" | "WPA3";
  /** FEELDSCOPE の設定(パスワード=WPA/WPA2 方式)でつながるか。WPA3 専用(SAE のみ)・WEP は不可 */
  supported: boolean;
}

/** wpa_cli の SSID 表記(printf_encode: \\ \" \e \n \r \t \xNN)を元の文字列に戻す */
export function decodeWpaSsid(s: string): string {
  const bytes: number[] = [];
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "\\" && i + 1 < s.length) {
      const n = s[i + 1];
      if (n === "x" && /^[0-9a-fA-F]{2}$/.test(s.slice(i + 2, i + 4))) { bytes.push(parseInt(s.slice(i + 2, i + 4), 16)); i += 3; continue; }
      const map: Record<string, number> = { "\\": 0x5c, '"': 0x22, e: 0x1b, n: 0x0a, r: 0x0d, t: 0x09 };
      if (n in map) { bytes.push(map[n]); i += 1; continue; }
    }
    for (const b of Buffer.from(c, "utf-8")) bytes.push(b);
  }
  return Buffer.from(bytes).toString("utf-8");
}

/** `wpa_cli -i wlan0 status` の出力 */
export function parseWpaStatus(out: string): WpaStatus {
  const kv: Record<string, string> = {};
  for (const line of out.split("\n")) {
    const i = line.indexOf("=");
    if (i > 0) kv[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  const freq = Number(kv.freq);
  return { state: kv.wpa_state || "", ssid: kv.ssid ? decodeWpaSsid(kv.ssid) : "", ip: kv.ip_address || "", freq: Number.isFinite(freq) && freq > 0 ? freq : null };
}

function securityOf(flags: string): { security: WifiNetwork["security"]; supported: boolean } {
  const f = flags.toUpperCase();
  const sae = /SAE/.test(f), psk = /PSK/.test(f);   // 例 [WPA2-PSK+SAE-CCMP]=混在 / [WPA2-SAE-CCMP]=WPA3 専用
  if (sae && !psk) return { security: "WPA3", supported: false };
  if (sae && psk) return { security: "WPA2/WPA3", supported: true };
  if (/WPA2/.test(f)) return { security: "WPA2", supported: true };
  if (/WPA/.test(f)) return { security: "WPA", supported: true };
  if (/WEP/.test(f)) return { security: "WEP", supported: false };
  return { security: "OPEN", supported: false };   // 鍵の無いネットワーク(設定画面はパスワード必須なので対象外)
}

/** `wpa_cli -i wlan0 scan_results` の出力。非公開(空の SSID)は除き、強い順 */
export function parseScanResults(out: string): WifiNetwork[] {
  const by = new Map<string, WifiNetwork>();
  for (const line of out.split("\n")) {
    const cols = line.split("\t");
    if (cols.length < 5 || !/^[0-9a-f]{2}(:[0-9a-f]{2}){5}$/i.test(cols[0].trim())) continue;   // 見出し行などを除く
    const freq = Number(cols[1]), signal = Number(cols[2]);
    const ssid = decodeWpaSsid(cols.slice(4).join("\t"));
    if (!ssid || !Number.isFinite(signal)) continue;
    const band = freq >= 4900 ? "5GHz" : "2.4GHz";
    const sec = securityOf(cols[3]);
    const cur = by.get(ssid);
    if (!cur) by.set(ssid, { ssid, signal, bands: [band], ...sec });
    else {
      if (signal > cur.signal) cur.signal = signal;
      if (!cur.bands.includes(band)) cur.bands.push(band);
      if (!cur.supported && sec.supported) Object.assign(cur, sec);   // どれか1つでもつながる方式なら可
    }
  }
  for (const n of by.values()) n.bands.sort();
  return [...by.values()].sort((a, b) => b.signal - a.signal);
}

/** wpa_supplicant.conf の最初の network ブロックの SSID(ssid="…" か 16進表記)。無ければ "" */
export function parseConfiguredSsid(conf: string): string {
  const block = /network\s*=\s*\{([\s\S]*?)\}/.exec(conf);
  if (!block) return "";
  const m = /^\s*ssid\s*=\s*(.+?)\s*$/m.exec(block[1]);
  if (!m) return "";
  const v = m[1];
  if (v.startsWith('"')) {
    try { return JSON.parse(v); } catch { return v.replace(/^"|"$/g, ""); }   // FEELDSCOPE は JSON 文字列で書く。OGN 側の素の引用も読む
  }
  if (/^[0-9a-fA-F]+$/.test(v) && v.length % 2 === 0) return Buffer.from(v, "hex").toString("utf-8");
  return v;
}

/** /boot/OGN-receiver.conf の wifiName(wpa_supplicant.conf が読めないときの控え) */
export function parseOgnWifiName(conf: string): string {
  const m = /^wifiName="([^"]*)"/m.exec(conf);
  return m ? m[1] : "";
}
