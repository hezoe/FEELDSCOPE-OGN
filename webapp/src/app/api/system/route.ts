import { NextResponse } from "next/server";
import { exec } from "child_process";
import { promisify } from "util";
import { readFile, writeFile, unlink } from "fs/promises";

const execAsync = promisify(exec);

const ADSB_CONFIG_PATH = "/home/pi/FEELDSCOPE/adsb-config.json";
const AIRFIELD_CONFIG_PATH = "/home/pi/FEELDSCOPE/airfield-config.json";
const DHCPCD_CONF = "/etc/dhcpcd.conf";
const WPA_SUPPLICANT_CONF = "/etc/wpa_supplicant/wpa_supplicant.conf";
const FEELDSCOPE_OGN_DIR = "/home/pi/FEELDSCOPE-OGN";
const FEELDSCOPE_DIR = "/home/pi/FEELDSCOPE";

interface AirfieldConfig {
  name: string;
  latitude: number;
  longitude: number;
  elevation_m: number;
}

async function loadAirfieldConfig(): Promise<AirfieldConfig | null> {
  try {
    const data = await readFile(AIRFIELD_CONFIG_PATH, "utf-8");
    return JSON.parse(data);
  } catch {
    return null;
  }
}

async function saveAirfieldConfig(config: AirfieldConfig): Promise<void> {
  await writeFile(AIRFIELD_CONFIG_PATH, JSON.stringify(config, null, 2));
}

async function detectReceiverId(): Promise<string> {
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

async function loadAdsbConfig(): Promise<AdsbSavedConfig | null> {
  try {
    const data = await readFile(ADSB_CONFIG_PATH, "utf-8");
    return JSON.parse(data);
  } catch {
    return null;
  }
}

async function saveAdsbConfig(config: AdsbSavedConfig): Promise<void> {
  await writeFile(ADSB_CONFIG_PATH, JSON.stringify(config, null, 2));
}

async function removeAdsbConfig(): Promise<void> {
  try {
    await unlink(ADSB_CONFIG_PATH);
  } catch {
    // file may not exist
  }
}

async function isOverlayEnabled(): Promise<boolean> {
  try {
    const { stdout } = await execAsync("sudo overlayctl status");
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
    // Fetch remote to compare without pulling
    await execAsync(`cd ${FEELDSCOPE_OGN_DIR} && sudo -u pi git fetch origin --quiet`);
    // Compare package.json version rather than commit count — update-script commits
    // don't change the deployed version, so commits-ahead can be misleading
    try {
      const { stdout: remotePkg } = await execAsync(`cd ${FEELDSCOPE_OGN_DIR} && git show origin/master:webapp/package.json`);
      latest = JSON.parse(remotePkg).version || null;
    } catch { /* ignore */ }
    // Also check commits-ahead: if current deployed version matches remote, but
    // there are remote commits ahead, still offer update (e.g. hotfix without version bump)
    const { stdout } = await execAsync(`cd ${FEELDSCOPE_OGN_DIR} && git rev-list HEAD..origin/master --count`);
    const behind = parseInt(stdout.trim(), 10);
    updateAvailable = behind > 0 && latest !== current;
  } catch { /* ignore */ }

  return { current, latest, updateAvailable };
}

// ── Network helpers ──

interface NetworkStatus {
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

async function getNetworkStatus(): Promise<NetworkStatus> {
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
    wifi: { ssid: wifiSsid, connected: wifiConnected },
    eth: { connected: ethConnected, method: ethMethod, ip: ethIp, subnet: ethSubnet, gateway: ethGateway, dns: ethDns },
  };
}

async function applyWifiConfig(ssid: string, password: string): Promise<void> {
  // Write a clean wpa_supplicant.conf
  const content = `ctrl_interface=DIR=/var/run/wpa_supplicant GROUP=netdev
update_config=1

country=JP
network={
    ssid="${ssid}"
    psk="${password}"
}
`;
  await execAsync(`sudo bash -c 'cat > ${WPA_SUPPLICANT_CONF} << WPAEOF
${content}
WPAEOF'`);
  await execAsync("sudo wpa_cli -i wlan0 reconfigure").catch(() => {});
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
    const cidr = subnetToCidr(subnet);
    content += `\n\n# FEELDSCOPE eth0 static config\ninterface eth0\nstatic ip_address=${ip}/${cidr}\n`;
    if (gateway) content += `static routers=${gateway}\n`;
    if (dns) content += `static domain_name_servers=${dns}\n`;
  }

  await execAsync(`sudo bash -c 'cat > ${DHCPCD_CONF} << DHCPEOF
${content}
DHCPEOF'`);
  // Restart dhcpcd to apply
  await execAsync("sudo systemctl restart dhcpcd").catch(() => {});
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

  const [adsbConfig, airfieldConfig, network, version] = await Promise.all([
    loadAdsbConfig(),
    loadAirfieldConfig(),
    getNetworkStatus(),
    getVersionInfo(),
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
  });
}

// POST /api/system - Switch mode
export async function POST(request: Request) {
  const body = await request.json();
  const { action, speed } = body;

  try {
    switch (action) {
      case "realtime":
        // Start ogn-mqtt (Conflicts= will stop igc-simulator)
        await execAsync("sudo systemctl start ogn-mqtt");
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
        const overrideDir = "/etc/systemd/system/igc-simulator.service.d";
        await execAsync(`sudo mkdir -p ${overrideDir}`);
        await execAsync(`sudo bash -c 'cat > ${overrideDir}/speed.conf << EOF
[Service]
ExecStart=
ExecStart=/usr/bin/python3 /home/pi/FEELDSCOPE/igc-simulator.py --speed ${replaySpeed} --loop --dir /home/pi/FEELDSCOPE/testdata
EOF'`);
        await execAsync("sudo systemctl daemon-reload");
        await execAsync("sudo systemctl start igc-simulator");
        return NextResponse.json({ ok: true, mode: "history", speed: replaySpeed });
      }

      case "stop":
        await execAsync(
          "sudo systemctl stop ogn-mqtt; sudo systemctl stop igc-simulator"
        );
        return NextResponse.json({ ok: true, mode: "stopped" });

      case "adsb-start": {
        const adsbUrl = body.url || "";
        const adsbInterval = Math.max(1, Math.min(30, parseInt(body.interval, 10) || 3));
        // Write systemd override with the URL and interval
        const adsbOverrideDir = "/etc/systemd/system/adsb-poller.service.d";
        await execAsync(`sudo mkdir -p ${adsbOverrideDir}`);
        const safeUrl = adsbUrl.replace(/'/g, "");
        await execAsync(`sudo bash -c 'cat > ${adsbOverrideDir}/config.conf << EOF
[Service]
ExecStart=
ExecStart=/usr/bin/python3 /home/pi/FEELDSCOPE/adsb-poller.py --url ${safeUrl} --interval ${adsbInterval}
EOF'`);
        await execAsync("sudo systemctl daemon-reload");
        await execAsync("sudo systemctl restart adsb-poller");
        // Persist config and enable auto-start on boot
        await saveAdsbConfig({ enabled: true, url: adsbUrl, interval: adsbInterval });
        await execAsync("sudo systemctl enable adsb-poller").catch(() => {});
        return NextResponse.json({ ok: true, adsb: "started" });
      }

      case "adsb-stop": {
        await execAsync("sudo systemctl stop adsb-poller");
        await execAsync("sudo systemctl disable adsb-poller").catch(() => {});
        await removeAdsbConfig();
        // Clear retained ADS-B MQTT messages
        const rid = await detectReceiverId();
        await execAsync(`mosquitto_pub -t 'ogn/${rid}/aircraft_adsb' -r -n`).catch(() => {});
        return NextResponse.json({ ok: true, adsb: "stopped" });
      }

      case "reboot":
        // Respond before rebooting
        setTimeout(() => execAsync("sudo systemctl reboot"), 500);
        return NextResponse.json({ ok: true, message: "再起動します..." });

      case "shutdown":
        // Respond before shutting down
        setTimeout(() => execAsync("sudo systemctl poweroff"), 500);
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
        await execAsync("sudo rm -f /tmp/feeldscope-update.log && sudo touch /tmp/feeldscope-update.log && sudo chmod 666 /tmp/feeldscope-update.log");
        await execAsync(`sudo bash -c 'cat > /tmp/feeldscope-do-update.sh << "SCRIPT"
#!/bin/bash
cd ${FEELDSCOPE_OGN_DIR}
exec bash feeldscope-update.sh > /tmp/feeldscope-update.log 2>&1
SCRIPT
chmod +x /tmp/feeldscope-do-update.sh'`);
        // Reset any previous failed unit before starting new one
        await execAsync("sudo systemctl reset-failed feeldscope-update 2>/dev/null || true");
        await execAsync("sudo systemd-run --unit=feeldscope-update --description='FEELDSCOPE Update' /tmp/feeldscope-do-update.sh");
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
        await execAsync("sudo overlayctl enable");
        return NextResponse.json({ ok: true, message: "オーバーレイFSを有効にしました。再起動後に反映されます。" });

      case "overlay-disable":
        await execAsync("sudo overlayctl disable");
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
