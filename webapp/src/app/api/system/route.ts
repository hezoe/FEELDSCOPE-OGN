import { NextResponse } from "next/server";
import { exec } from "child_process";
import { promisify } from "util";
import { readFile, writeFile } from "fs/promises";
import { existsSync } from "fs";
import { getAuthContext, isAuthorizedToMutate } from "@/lib/auth";

const execAsync = promisify(exec);

const FEELDSCOPE_DIR = process.env.FEELDSCOPE_DIR || "/home/pi/FEELDSCOPE";
const FEELDSCOPE_OGN_DIR = process.env.FEELDSCOPE_OGN_DIR || "/home/pi/FEELDSCOPE-OGN";
const ADSB_CONFIG_PATH = process.env.FEELDSCOPE_ADSB_CONFIG || `${FEELDSCOPE_DIR}/adsb-config.json`;
const AIRFIELD_CONFIG_PATH = process.env.FEELDSCOPE_AIRFIELD_CONFIG || `${FEELDSCOPE_DIR}/airfield-config.json`;
const DHCPCD_CONF = "/etc/dhcpcd.conf";
const WPA_SUPPLICANT_CONF = "/etc/wpa_supplicant/wpa_supplicant.conf";
const OGN_RECEIVER_CONF = "/boot/OGN-receiver.conf";

// 設定ファイルを root で安全に書き込む。シェルを介さず内容を「データ」としてtmpへ書き、
// 固定パスの cp で反映する（cp の引数は当方管理の定数/生成名のみ＝ユーザー入力なし）。
// これにより SSID/パスワード/IP 等の入力値によるコマンド注入(root昇格)を構造的に排除する。
async function writeRootFile(target: string, content: string): Promise<void> {
  const tmp = `/tmp/feeldscope-cfg-${process.pid}-${Math.random().toString(36).slice(2)}`;
  await writeFile(tmp, content, { mode: 0o600 });
  try {
    await execAsync(`sudo -n cp ${tmp} ${target}`);
  } finally {
    await execAsync(`sudo -n rm -f ${tmp}`).catch(() => {});
  }
}

function isIpv4(s: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(s.trim());
  return !!m && m.slice(1).every((o) => Number(o) >= 0 && Number(o) <= 255);
}
function assertIpv4(v: string | undefined, label: string): void {
  if (v && !isIpv4(v)) throw new Error(`${label}が不正なIPv4形式です`);
}

interface AirfieldConfig {
  name: string;
  latitude: number;
  longitude: number;
  elevation_m: number;
}

const DEFAULT_AIRFIELD: AirfieldConfig = {
  name: "関宿滑空場",
  latitude: 36.0095,
  longitude: 139.818,
  elevation_m: 10,
};

async function loadAirfieldConfig(): Promise<AirfieldConfig> {
  try {
    const data = await readFile(AIRFIELD_CONFIG_PATH, "utf-8");
    const parsed = JSON.parse(data);
    return {
      name: typeof parsed.name === "string" ? parsed.name : DEFAULT_AIRFIELD.name,
      latitude: typeof parsed.latitude === "number" ? parsed.latitude : DEFAULT_AIRFIELD.latitude,
      longitude: typeof parsed.longitude === "number" ? parsed.longitude : DEFAULT_AIRFIELD.longitude,
      elevation_m: typeof parsed.elevation_m === "number" ? parsed.elevation_m : DEFAULT_AIRFIELD.elevation_m,
    };
  } catch {
    return DEFAULT_AIRFIELD;
  }
}

async function saveAirfieldConfig(config: AirfieldConfig): Promise<void> {
  await writeFile(AIRFIELD_CONFIG_PATH, JSON.stringify(config, null, 2));
}

async function detectReceiverId(): Promise<string> {
  if (process.env.FEELDSCOPE_RECEIVER_ID) return process.env.FEELDSCOPE_RECEIVER_ID;
  try {
    const data = await readFile("/boot/OGN-receiver.conf", "utf-8");
    const m = data.match(/ReceiverName="([^"#]+)"/);
    if (m) return m[1];
  } catch { /* ignore */ }
  try {
    const data = await readFile("/home/pi/rtlsdr-ogn.conf", "utf-8");
    const m = data.match(/Call\s*=\s*"([^"]+)"/);
    if (m) return m[1];
  } catch { /* ignore */ }
  return "OGNReceiver";
}

interface AdsbSavedConfig {
  enabled: boolean;
  url: string;
  interval: number;
}

async function loadAdsbConfig(): Promise<AdsbSavedConfig> {
  try {
    const data = await readFile(ADSB_CONFIG_PATH, "utf-8");
    const parsed = JSON.parse(data);
    return {
      enabled: parsed.enabled === true,
      url: typeof parsed.url === "string" ? parsed.url : "",
      interval: typeof parsed.interval === "number" ? parsed.interval : 3,
    };
  } catch {
    return { enabled: false, url: "", interval: 3 };
  }
}

async function saveAdsbConfig(config: AdsbSavedConfig): Promise<void> {
  await writeFile(ADSB_CONFIG_PATH, JSON.stringify(config, null, 2));
}

async function isOverlayEnabled(): Promise<boolean> {
  try {
    const { stdout } = await execAsync("sudo -n overlayctl status");
    return stdout.includes("overlay is active") || stdout.includes("overlay enabled");
  } catch {
    return false;
  }
}

async function isActive(service: string): Promise<boolean> {
  try {
    const { stdout } = await execAsync(`systemctl is-active ${service}`);
    return stdout.trim() === "active";
  } catch {
    return false;
  }
}

/** Publish a JSON message to an MQTT topic via mosquitto_pub */
async function mqttPublish(topic: string, payload: object): Promise<void> {
  const msg = JSON.stringify(payload).replace(/'/g, "'\\''");
  await execAsync(`mosquitto_pub -t '${topic}' -m '${msg}'`);
}

// ── Version / Update helpers ──

async function getVersionInfo(): Promise<{ current: string; latest: string | null; updateAvailable: boolean }> {
  let current = "unknown";
  try {
    const pkg = await readFile(`${FEELDSCOPE_DIR}/webapp/package.json`, "utf-8");
    current = JSON.parse(pkg).version || "unknown";
  } catch { /* ignore */ }

  let latest: string | null = null;
  let updateAvailable = false;
  try {
    // Fetch remote to compare without pulling. Try sudo -u pi first (RPi),
    // fall back to plain git fetch (VPS or any other env).
    await execAsync(`cd ${FEELDSCOPE_OGN_DIR} && (sudo -n -u pi git fetch origin --quiet 2>/dev/null || git fetch origin --quiet)`);
    // Compare package.json version rather than commit count — update-script commits
    // don't change the deployed version, so commits-ahead can be misleading
    try {
      const { stdout: remotePkg } = await execAsync(`cd ${FEELDSCOPE_OGN_DIR} && git show origin/master:webapp/package.json`);
      latest = JSON.parse(remotePkg).version || null;
    } catch { /* ignore */ }
    // Update available only when version string differs.
    // Same version = same state for all users (policy: always bump patch for any change).
    const { stdout } = await execAsync(`cd ${FEELDSCOPE_OGN_DIR} && git rev-list HEAD..origin/master --count`);
    const behind = parseInt(stdout.trim(), 10);
    updateAvailable = behind > 0 && latest !== current;
  } catch { /* ignore */ }

  return { current, latest, updateAvailable };
}

// ── Remote support (CATVPN / wg-quick@wg0) helpers ──

// リモートサポートは「既定OFF・有効化から3時間で自動OFF・時間内は再起動しても維持」。
// 状態は expiresAt(epoch秒) を state ファイルに記録し、systemd timer/boot サービス
// (feeldscope-remote-support-check.sh) が wg-quick@wg0 を start/stop して強制する。
const REMOTE_SUPPORT_STATE = process.env.FEELDSCOPE_REMOTE_SUPPORT_STATE
  || `${FEELDSCOPE_DIR}/remote-support.json`;
const REMOTE_SUPPORT_DURATION_SEC = 3 * 60 * 60; // 3h

interface RemoteSupportStatus {
  configured: boolean;       // /etc/wireguard/wg0.conf exists
  enabled: boolean;          // systemctl is-enabled wg-quick@wg0
  active: boolean;           // systemctl is-active wg-quick@wg0
  expires_at?: number;       // epoch秒（自動OFF時刻）。ON中のみ
  remaining_seconds?: number;// 自動OFFまでの残り秒（ON中のみ、>0）
  catvpn_hostname?: string;  // FQDN like takikawa-01.feeldscope.wg (admin can ssh to this)
  assigned_ip?: string;      // CATVPN-assigned IP (e.g., 10.66.20.12)
}

async function readRemoteSupportExpiry(): Promise<number> {
  try {
    const p = JSON.parse(await readFile(REMOTE_SUPPORT_STATE, "utf-8"));
    return typeof p.expiresAt === "number" ? p.expiresAt : 0;
  } catch { return 0; }
}
async function writeRemoteSupportExpiry(expiresAt: number): Promise<void> {
  await writeFile(REMOTE_SUPPORT_STATE, JSON.stringify({ expiresAt, durationSec: REMOTE_SUPPORT_DURATION_SEC }, null, 2), { mode: 0o644 });
}

async function getRemoteSupportStatus(): Promise<RemoteSupportStatus> {
  // /etc/wireguard/wg0.conf は root:root 0600 が普通なので sudo で存在確認する
  let configured = false;
  try {
    await execAsync("sudo -n test -f /etc/wireguard/wg0.conf");
    configured = true;
  } catch { /* not configured or no sudo */ }

  let enabled = false;
  try {
    const { stdout } = await execAsync("systemctl is-enabled wg-quick@wg0 2>/dev/null || true");
    enabled = stdout.trim() === "enabled";
  } catch { /* ignore */ }

  let active = false;
  try {
    const { stdout } = await execAsync("systemctl is-active wg-quick@wg0 2>/dev/null || true");
    active = stdout.trim() === "active";
  } catch { /* ignore */ }

  // /etc/catvpn/identity に CATVPN固有ホスト名 (例: feeldscope-1a2b3c.feeldscope.wg) と
  // 割当IPが記録されている。これは catvpn-enroll.sh が登録時に書き込む。
  let catvpn_hostname: string | undefined;
  let assigned_ip: string | undefined;
  try {
    const data = await readFile("/etc/catvpn/identity", "utf-8");
    for (const line of data.split("\n")) {
      const m = line.match(/^(\w+)=(.*)$/);
      if (!m) continue;
      if (m[1] === "hostname") catvpn_hostname = m[2].trim();
      if (m[1] === "assigned_ip") assigned_ip = m[2].trim();
    }
  } catch { /* not enrolled yet */ }

  // 時限状態
  const expiresAt = await readRemoteSupportExpiry();
  const now = Math.floor(Date.now() / 1000);
  const remaining = expiresAt > now ? expiresAt - now : 0;

  return {
    configured, enabled, active,
    expires_at: remaining > 0 ? expiresAt : undefined,
    remaining_seconds: remaining > 0 ? remaining : undefined,
    catvpn_hostname, assigned_ip,
  };
}

async function setRemoteSupport(enable: boolean): Promise<void> {
  const status = await getRemoteSupportStatus();
  if (!status.configured) {
    throw new Error("CATVPN未登録: /etc/wireguard/wg0.conf がありません。管理者にお問い合わせください。");
  }
  if (enable) {
    // 3時間の窓を記録して起動（enableはしない＝boot復帰はcheckスクリプトがexpiresAtで判断）
    const expiresAt = Math.floor(Date.now() / 1000) + REMOTE_SUPPORT_DURATION_SEC;
    await writeRemoteSupportExpiry(expiresAt);
    await execAsync("sudo -n systemctl start wg-quick@wg0");
    // 保険: systemd enable による恒久ONを解除しておく（時限管理は自前で行う）
    await execAsync("sudo -n systemctl disable wg-quick@wg0").catch(() => {});
  } else {
    await writeRemoteSupportExpiry(0);
    await execAsync("sudo -n systemctl stop wg-quick@wg0").catch(() => {});
    await execAsync("sudo -n systemctl disable wg-quick@wg0").catch(() => {});
  }
}

// ── Auto-reboot (cron) helpers ──

interface AutoRebootConfig {
  enabled: boolean;
  hour: number;   // 0-23
  minute: number; // 0-59
}

async function getAutoRebootConfig(): Promise<AutoRebootConfig> {
  // Try sudo first (RPi has passwordless sudo); fall back to plain crontab
  // -n: never prompt for password (fails fast on VPS without sudoers entry)
  try {
    const { stdout } = await execAsync("sudo -n crontab -l 2>/dev/null || crontab -l 2>/dev/null || true");
    const lines = stdout.split("\n");
    for (const line of lines) {
      const m = line.match(/^\s*(\d+)\s+(\d+)\s+\*\s+\*\s+\*\s+.*reboot/);
      if (m) {
        return { enabled: true, minute: parseInt(m[1], 10), hour: parseInt(m[2], 10) };
      }
    }
  } catch { /* ignore */ }
  return { enabled: false, hour: 5, minute: 0 };
}

async function saveAutoRebootConfig(cfg: AutoRebootConfig): Promise<void> {
  if (cfg.hour < 0 || cfg.hour > 23) throw new Error("時(hour)は 0〜23 の範囲です");
  if (cfg.minute < 0 || cfg.minute > 59) throw new Error("分(minute)は 0〜59 の範囲です");

  // Read existing crontab (sans reboot lines), append new line if enabled
  const { stdout } = await execAsync("sudo -n crontab -l 2>/dev/null || true");
  const filtered = stdout.split("\n").filter(line => !/.*\/sbin\/reboot\s*$/.test(line)).join("\n");
  let newCron = filtered.trimEnd();
  if (cfg.enabled) {
    if (newCron) newCron += "\n";
    newCron += `${cfg.minute} ${cfg.hour} * * * /sbin/reboot\n`;
  } else {
    newCron += "\n";
  }
  // Install via stdin
  await execAsync(`echo ${JSON.stringify(newCron)} | sudo -n crontab -`);
}

// ── Network helpers ──

interface NetworkStatus {
  hostname: string;
  wifi: { ssid: string; connected: boolean };
  eth: {
    connected: boolean;
    method: "dhcp" | "static";
    ip: string;
    subnet: string;
    gateway: string;
    dns: string;
  };
}

function cidrToSubnet(cidr: number): string {
  const mask = (0xffffffff << (32 - cidr)) >>> 0;
  return `${(mask >>> 24) & 0xff}.${(mask >>> 16) & 0xff}.${(mask >>> 8) & 0xff}.${mask & 0xff}`;
}

function subnetToCidr(subnet: string): number {
  const parts = subnet.split(".").map(Number);
  const n = ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
  return n.toString(2).split("1").length - 1;
}

async function getHostname(): Promise<string> {
  try {
    const { stdout } = await execAsync("hostname");
    return stdout.trim();
  } catch {
    return "";
  }
}

async function applyHostname(name: string): Promise<void> {
  // Update /etc/hostname, /etc/hosts (127.0.1.1 entry), and apply via hostnamectl
  const safe = name.replace(/[^a-zA-Z0-9-]/g, "");
  if (!safe || safe.length > 63 || /^-/.test(safe) || /-$/.test(safe)) {
    throw new Error("ホスト名は英数字とハイフンのみ、63文字以内、先頭末尾はハイフン不可です");
  }
  await execAsync(`sudo -n hostnamectl set-hostname ${safe}`);
  // Update /etc/hosts 127.0.1.1 entry
  await execAsync(`sudo -n sed -i -E 's/^(127\\.0\\.1\\.1\\s+).*/\\1${safe}/' /etc/hosts`);
  // Restart avahi to refresh mDNS
  await execAsync("sudo -n systemctl restart avahi-daemon").catch(() => {});
}

async function getNetworkStatus(): Promise<NetworkStatus> {
  const hostname = await getHostname();
  // Wi-Fi
  let wifiSsid = "";
  let wifiConnected = false;
  try {
    const { stdout } = await execAsync("iwgetid -r 2>/dev/null || true");
    wifiSsid = stdout.trim();
    wifiConnected = wifiSsid.length > 0;
  } catch { /* ignore */ }

  // Ethernet
  let ethConnected = false;
  let ethIp = "";
  let ethSubnet = "";
  let ethGateway = "";
  let ethDns = "";
  let ethMethod: "dhcp" | "static" = "dhcp";

  try {
    const { stdout } = await execAsync("ip -4 addr show eth0 2>/dev/null || true");
    const m = stdout.match(/inet (\d+\.\d+\.\d+\.\d+)\/(\d+)/);
    if (m) {
      ethIp = m[1];
      ethSubnet = cidrToSubnet(parseInt(m[2], 10));
    }
    const { stdout: carrier } = await execAsync("cat /sys/class/net/eth0/carrier 2>/dev/null || echo 0");
    ethConnected = carrier.trim() === "1";
  } catch { /* ignore */ }

  try {
    const { stdout: routeOut } = await execAsync("ip route show dev eth0 2>/dev/null | grep default || true");
    const gm = routeOut.match(/default via (\d+\.\d+\.\d+\.\d+)/);
    if (gm) ethGateway = gm[1];
  } catch { /* ignore */ }

  try {
    const { stdout: resolvOut } = await execAsync("cat /etc/resolv.conf");
    const dnsServers = [...resolvOut.matchAll(/nameserver\s+(\S+)/g)].map(m => m[1]);
    ethDns = dnsServers.join(", ");
  } catch { /* ignore */ }

  // Check if eth0 has a static block in dhcpcd.conf
  try {
    const dhcpcdContent = await readFile(DHCPCD_CONF, "utf-8");
    if (/^interface\s+eth0\b/m.test(dhcpcdContent) && /static\s+ip_address/m.test(dhcpcdContent)) {
      // extract static config from dhcpcd.conf
      const ethBlock = dhcpcdContent.slice(dhcpcdContent.search(/^interface\s+eth0\b/m));
      const ipMatch = ethBlock.match(/static\s+ip_address=(\d+\.\d+\.\d+\.\d+)\/(\d+)/);
      const gwMatch = ethBlock.match(/static\s+routers=(\S+)/);
      const dnsMatch = ethBlock.match(/static\s+domain_name_servers=(.+)/);
      if (ipMatch) {
        ethMethod = "static";
        ethIp = ipMatch[1];
        ethSubnet = cidrToSubnet(parseInt(ipMatch[2], 10));
      }
      if (gwMatch) ethGateway = gwMatch[1];
      if (dnsMatch) ethDns = dnsMatch[1].trim();
    }
  } catch { /* ignore */ }

  return {
    hostname,
    wifi: { ssid: wifiSsid, connected: wifiConnected },
    eth: { connected: ethConnected, method: ethMethod, ip: ethIp, subnet: ethSubnet, gateway: ethGateway, dns: ethDns },
  };
}

// OGN 公式イメージの設定マネージャ (/root/OGN-receiver-config-manager) は、
// /boot/OGN-receiver.conf の wifiPassword が空でない限り、rtlsdr-ogn の起動のたびに
// wpa_supplicant.conf へ network ブロックを *追記* する。
// そのため GUI で Wi-Fi を変更しても /boot 側を放置すると、
//   1) 旧 SSID が毎起動で復活し、意図しない AP に繋がりうる
//   2) network ブロックが起動ごとに増え続ける（実機で 166 個まで増殖）
// という不整合が起きる。GUI で変更したら /boot 側も必ず揃える。
async function syncOgnReceiverWifi(ssid: string, password: string): Promise<void> {
  try {
    const recv = await readFile(OGN_RECEIVER_CONF, "utf-8");
    // ssid/psk はダブルクォートを含みうるので除去してから埋め込む
    // （/boot/OGN-receiver.conf は shell 変数形式のため JSON エスケープは使えない）
    const safeSsid = ssid.replace(/["\\$`]/g, "");
    const safePass = password.replace(/["\\$`]/g, "");
    let next = recv;
    const set = (key: string, value: string) => {
      const re = new RegExp(`^#?\\s*${key}=".*"`, "m");
      if (re.test(next)) {
        next = next.replace(re, `${key}="${value}"`);
      } else {
        if (!next.endsWith("\n")) next += "\n";
        next += `${key}="${value}"\n`;
      }
    };
    set("wifiName", safeSsid);
    set("wifiPassword", safePass);
    set("wifiCountry", "JP");
    if (next !== recv) await writeRootFile(OGN_RECEIVER_CONF, next);
  } catch {
    // /boot/OGN-receiver.conf が無い環境（VPS 等）では何もしない
  }
}

async function applyWifiConfig(ssid: string, password: string): Promise<void> {
  if (!ssid || ssid.length > 63) throw new Error("SSIDが不正です（1〜63文字）");
  if (password.length < 8 || password.length > 63) throw new Error("Wi-Fiパスワードは8〜63文字にしてください");
  // ssid/psk は JSON 文字列化でクォート・エスケープ（設定破壊/注入を防止）。
  // 書き込みは writeRootFile 経由でシェルを介さない（コマンド注入不可）。
  const content = `ctrl_interface=DIR=/var/run/wpa_supplicant GROUP=netdev
update_config=1

country=JP
network={
    ssid=${JSON.stringify(ssid)}
    psk=${JSON.stringify(password)}
}
`;
  await writeRootFile(WPA_SUPPLICANT_CONF, content);
  // OGN 設定マネージャが古い認証情報を復活させないよう /boot 側も揃える
  await syncOgnReceiverWifi(ssid, password);
  await execAsync("sudo -n wpa_cli -i wlan0 reconfigure").catch(() => {});
}

async function applyEthConfig(method: "dhcp" | "static", ip?: string, subnet?: string, gateway?: string, dns?: string): Promise<void> {
  // Read current dhcpcd.conf and remove existing eth0 static block
  let content = "";
  try {
    content = await readFile(DHCPCD_CONF, "utf-8");
  } catch { /* ignore */ }

  // Remove any existing eth0 static block (from "interface eth0" to next "interface" or EOF)
  content = content.replace(/\n*# FEELDSCOPE eth0 static config\ninterface eth0\n(?:static [^\n]+\n)*/g, "");
  content = content.trimEnd();

  if (method === "static" && ip && subnet) {
    // IPv4 厳格バリデーション（数字とドットのみ許容＝設定破壊/注入を排除）
    assertIpv4(ip, "IPアドレス");
    assertIpv4(subnet, "サブネットマスク");
    assertIpv4(gateway, "デフォルトゲートウェイ");
    if (dns) { for (const d of dns.trim().split(/\s+/)) assertIpv4(d, "DNSサーバ"); }
    const cidr = subnetToCidr(subnet);
    content += `\n\n# FEELDSCOPE eth0 static config\ninterface eth0\nstatic ip_address=${ip}/${cidr}\n`;
    if (gateway) content += `static routers=${gateway}\n`;
    if (dns) content += `static domain_name_servers=${dns.trim()}\n`;
  }

  // 書き込みは writeRootFile 経由でシェルを介さない（コマンド注入不可）
  await writeRootFile(DHCPCD_CONF, content + "\n");
  // Restart dhcpcd to apply
  await execAsync("sudo -n systemctl restart dhcpcd").catch(() => {});
}

// GET /api/system - Get current system status
export async function GET() {
  const [ognMqtt, igcSim, mosquitto, adsbPoller, overlayEnabled, receiverId] = await Promise.all([
    isActive("ogn-mqtt"),
    isActive("igc-simulator"),
    isActive("mosquitto"),
    isActive("adsb-poller"),
    isOverlayEnabled(),
    detectReceiverId(),
  ]);

  let mode: "realtime" | "history" | "stopped" = "stopped";
  if (ognMqtt) mode = "realtime";
  else if (igcSim) mode = "history";

  const [adsbConfig, airfieldConfig, network, version, autoReboot, remoteSupport] = await Promise.all([
    loadAdsbConfig(),
    loadAirfieldConfig(),
    getNetworkStatus(),
    getVersionInfo(),
    getAutoRebootConfig(),
    getRemoteSupportStatus(),
  ]);

  return NextResponse.json({
    mode,
    receiver_id: receiverId,
    airfield_config: airfieldConfig,
    ogn_mqtt_active: ognMqtt,
    igc_simulator_active: igcSim,
    mosquitto_active: mosquitto,
    adsb_poller_active: adsbPoller,
    overlay_enabled: overlayEnabled,
    adsb_config: adsbConfig,
    network,
    version,
    auto_reboot: autoReboot,
    remote_support: remoteSupport,
  });
}

// POST /api/system - Switch mode
export async function POST(request: Request) {
  const body = await request.json();
  const { action, speed } = body;

  // 認証ゲート: リモートサポート関連(ON/OFF・初回登録)以外の変更操作は
  // 「管理者ログイン or オペレーター(リモートサポート中の管理者)」が必須。
  // 閲覧(GET)は無認証。リモートサポートは失念時の唯一の解除導線なので、
  //   トグル(remote-support-save)も初回登録(catvpn-enroll)も無認証で許可する。
  const OPEN_ACTIONS = new Set(["remote-support-save", "catvpn-enroll"]);
  if (!OPEN_ACTIONS.has(action)) {
    const ctx = await getAuthContext(request);
    if (!isAuthorizedToMutate(ctx)) {
      return NextResponse.json(
        { error: "設定変更には管理者ログインが必要です。", needsAuth: true },
        { status: 401 }
      );
    }
  }

  try {
    switch (action) {
      case "realtime":
        // Start ogn-mqtt (Conflicts= will stop igc-simulator)
        await execAsync("sudo -n systemctl start ogn-mqtt");
        return NextResponse.json({ ok: true, mode: "realtime" });

      case "history": {
        const replaySpeed = Math.max(1, Math.min(20, parseInt(speed, 10) || 10));

        // Check if igc-simulator is already running
        const alreadyRunning = await isActive("igc-simulator");

        if (alreadyRunning) {
          // Send speed change command via MQTT (no restart)
          const rid = await detectReceiverId();
          await mqttPublish(`ogn/${rid}/command`, { speed: replaySpeed });
          return NextResponse.json({ ok: true, mode: "history", speed: replaySpeed });
        }

        // Not running: update systemd override and start
        const ridForSim = (await detectReceiverId()).replace(/'/g, "");
        const overrideDir = "/etc/systemd/system/igc-simulator.service.d";
        await execAsync(`sudo -n mkdir -p ${overrideDir}`);
        await execAsync(`sudo -n bash -c 'cat > ${overrideDir}/speed.conf << EOF
[Service]
ExecStart=
ExecStart=/usr/bin/python3 ${FEELDSCOPE_DIR}/igc-simulator.py --speed ${replaySpeed} --loop --receiver-id ${ridForSim} --dir ${FEELDSCOPE_DIR}/testdata
EOF'`);
        await execAsync("sudo -n systemctl daemon-reload");
        await execAsync("sudo -n systemctl start igc-simulator");
        return NextResponse.json({ ok: true, mode: "history", speed: replaySpeed });
      }

      case "stop":
        await execAsync(
          "sudo -n systemctl stop ogn-mqtt; sudo -n systemctl stop igc-simulator"
        );
        return NextResponse.json({ ok: true, mode: "stopped" });

      case "adsb-start": {
        const adsbUrl = body.url || "";
        const adsbInterval = Math.max(1, Math.min(30, parseInt(body.interval, 10) || 3));
        // webapp と adsb-poller でトピック宛先を一致させるため receiver-id を明示
        const ridForPoller = (await detectReceiverId()).replace(/'/g, "");
        // Write systemd override with the URL, interval and receiver-id
        const adsbOverrideDir = "/etc/systemd/system/adsb-poller.service.d";
        await execAsync(`sudo -n mkdir -p ${adsbOverrideDir}`);
        const safeUrl = adsbUrl.replace(/'/g, "");
        await execAsync(`sudo -n bash -c 'cat > ${adsbOverrideDir}/config.conf << EOF
[Service]
ExecStart=
ExecStart=/usr/bin/python3 ${FEELDSCOPE_DIR}/adsb-poller.py --url ${safeUrl} --interval ${adsbInterval} --receiver-id ${ridForPoller}
EOF'`);
        await execAsync("sudo -n systemctl daemon-reload");
        await execAsync("sudo -n systemctl restart adsb-poller");
        // Persist config and enable auto-start on boot
        await saveAdsbConfig({ enabled: true, url: adsbUrl, interval: adsbInterval });
        await execAsync("sudo -n systemctl enable adsb-poller").catch(() => {});
        return NextResponse.json({ ok: true, adsb: "started" });
      }

      case "adsb-stop": {
        await execAsync("sudo -n systemctl stop adsb-poller");
        await execAsync("sudo -n systemctl disable adsb-poller").catch(() => {});
        // Persist disabled state (preserve url/interval for re-enable convenience)
        const prev = await loadAdsbConfig();
        await saveAdsbConfig({
          enabled: false,
          url: prev?.url ?? "",
          interval: prev?.interval ?? 3,
        });
        // Clear retained ADS-B MQTT messages（receiverIdが変わった過去残存にも対応するためワイルドカードクリアは不可、
        // 主要トピックだけ明示クリア。adsb_status の取り残しが「停止中なのに正常受信中」と誤表示する原因）
        const rid = await detectReceiverId();
        await execAsync(`mosquitto_pub -t 'ogn/${rid}/aircraft_adsb' -r -n`).catch(() => {});
        await execAsync(`mosquitto_pub -t 'ogn/${rid}/adsb_status'   -r -n`).catch(() => {});
        return NextResponse.json({ ok: true, adsb: "stopped" });
      }

      case "reboot":
        // Respond before rebooting
        setTimeout(() => execAsync("sudo -n systemctl reboot"), 500);
        return NextResponse.json({ ok: true, message: "再起動します..." });

      case "shutdown":
        // Respond before shutting down
        setTimeout(() => execAsync("sudo -n systemctl poweroff"), 500);
        return NextResponse.json({ ok: true, message: "シャットダウンします..." });

      case "airfield-save": {
        const airfield: AirfieldConfig = {
          name: body.name,
          latitude: body.latitude,
          longitude: body.longitude,
          elevation_m: body.elevation_m,
        };
        await saveAirfieldConfig(airfield);
        return NextResponse.json({ ok: true, airfield });
      }

      case "hostname-save": {
        const name = (body.hostname || "").trim();
        if (!name) return NextResponse.json({ error: "ホスト名を入力してください" }, { status: 400 });
        try {
          await applyHostname(name);
        } catch (e) {
          return NextResponse.json({ error: e instanceof Error ? e.message : "ホスト名設定に失敗しました" }, { status: 400 });
        }
        return NextResponse.json({ ok: true, message: `ホスト名を ${name} に設定しました。${name}.local でアクセス可能になります。` });
      }

      case "remote-support-save": {
        const enable = !!body.enabled;
        await setRemoteSupport(enable);
        return NextResponse.json({
          ok: true,
          message: enable
            ? "リモートサポート(CATVPN)を有効にしました。"
            : "リモートサポート(CATVPN)を無効にしました。外部からの保守接続は遮断されました。",
        });
      }

      case "catvpn-enroll": {
        const token = (body.token || "").trim();
        // catvpn API のトークン仕様 (16進32文字)
        if (!/^[a-f0-9]{32}$/i.test(token)) {
          return NextResponse.json(
            { error: "不正なトークン形式です。管理者から発行された32桁の16進文字列を入力してください。" },
            { status: 400 }
          );
        }
        if (!existsSync("/usr/local/bin/catvpn-enroll")) {
          return NextResponse.json(
            { error: "登録スクリプトが見つかりません。先にシステムアップデートを実行してください。" },
            { status: 500 }
          );
        }
        try {
          const { stdout } = await execAsync(
            `sudo -n /usr/local/bin/catvpn-enroll ${token} 2>&1`,
            { maxBuffer: 4 * 1024 * 1024, timeout: 60_000 }
          );
          return NextResponse.json({
            ok: true,
            message: "CATVPNに登録しました。リモートサポートが有効になりました。",
            log: stdout,
          });
        } catch (e: unknown) {
          const err = e as { stdout?: string; stderr?: string; message?: string };
          return NextResponse.json(
            {
              error: "登録に失敗しました。トークンの有効期限切れ・既使用・ネットワーク不通などをご確認ください。",
              log: (err.stdout || "") + (err.stderr || "") || err.message || "",
            },
            { status: 500 }
          );
        }
      }

      case "auto-reboot-save": {
        const cfg: AutoRebootConfig = {
          enabled: !!body.enabled,
          hour: parseInt(body.hour, 10),
          minute: parseInt(body.minute, 10),
        };
        await saveAutoRebootConfig(cfg);
        return NextResponse.json({
          ok: true,
          message: cfg.enabled
            ? `毎日 ${String(cfg.hour).padStart(2, "0")}:${String(cfg.minute).padStart(2, "0")} に自動再起動するよう設定しました。`
            : "自動再起動を無効にしました。",
        });
      }

      case "wifi-save": {
        const ssid = (body.ssid || "").trim();
        const password = body.password || "";
        if (!ssid) return NextResponse.json({ error: "SSIDを入力してください" }, { status: 400 });
        if (password.length < 8) return NextResponse.json({ error: "パスワードは8文字以上必要です" }, { status: 400 });
        await applyWifiConfig(ssid, password);
        return NextResponse.json({ ok: true, message: "Wi-Fi設定を適用しました。接続を試みています..." });
      }

      case "eth-save": {
        const ethMethod = body.method as "dhcp" | "static";
        if (ethMethod === "static") {
          if (!body.ip) return NextResponse.json({ error: "IPアドレスを入力してください" }, { status: 400 });
          if (!body.subnet) return NextResponse.json({ error: "サブネットマスクを入力してください" }, { status: 400 });
          await applyEthConfig("static", body.ip, body.subnet, body.gateway, body.dns);
        } else {
          await applyEthConfig("dhcp");
        }
        return NextResponse.json({ ok: true, message: "有線LAN設定を適用しました" });
      }

      case "system-update": {
        // Run the update script in the background; it will restart the webapp
        const overlayActive = await isOverlayEnabled();
        if (overlayActive) {
          return NextResponse.json({ error: "固定化(OverlayFS)が有効です。先に固定化をOFFにして再起動してください。" }, { status: 400 });
        }
        // Remove stale log and launch updater as independent systemd transient unit
        await execAsync("sudo -n rm -f /tmp/feeldscope-update.log && sudo -n touch /tmp/feeldscope-update.log && sudo -n chmod 666 /tmp/feeldscope-update.log");
        await execAsync(`sudo -n bash -c 'cat > /tmp/feeldscope-do-update.sh << "SCRIPT"
#!/bin/bash
cd ${FEELDSCOPE_OGN_DIR}
exec bash feeldscope-update.sh > /tmp/feeldscope-update.log 2>&1
SCRIPT
chmod +x /tmp/feeldscope-do-update.sh'`);
        // Reset any previous failed unit before starting new one
        await execAsync("sudo -n systemctl reset-failed feeldscope-update 2>/dev/null || true");
        await execAsync("sudo -n systemd-run --unit=feeldscope-update --description='FEELDSCOPE Update' /tmp/feeldscope-do-update.sh");
        return NextResponse.json({ ok: true, message: "アップデートを開始しました。完了後にWebアプリが自動再起動します。" });
      }

      case "update-log": {
        try {
          const log = await readFile("/tmp/feeldscope-update.log", "utf-8");
          return NextResponse.json({ ok: true, log });
        } catch {
          return NextResponse.json({ ok: true, log: "" });
        }
      }

      case "overlay-enable":
        await execAsync("sudo -n overlayctl enable");
        return NextResponse.json({ ok: true, message: "オーバーレイFSを有効にしました。再起動後に反映されます。" });

      case "overlay-disable":
        await execAsync("sudo -n overlayctl disable");
        return NextResponse.json({ ok: true, message: "オーバーレイFSを無効にしました。再起動後に反映されます。" });

      default:
        return NextResponse.json(
          { error: `Unknown action: ${action}` },
          { status: 400 }
        );
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
