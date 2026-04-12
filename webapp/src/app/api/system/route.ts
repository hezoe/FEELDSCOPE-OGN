import { NextResponse } from "next/server";
import { exec } from "child_process";
import { promisify } from "util";
import { readFile, writeFile, unlink } from "fs/promises";

const execAsync = promisify(exec);

const ADSB_CONFIG_PATH = "/home/pi/FEELDSCOPE/adsb-config.json";
const AIRFIELD_CONFIG_PATH = "/home/pi/FEELDSCOPE/airfield-config.json";

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
    const { stdout } = await execAsync("sudo raspi-config nonint get_overlay_conf");
    return stdout.trim() === "0";
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

  const [adsbConfig, airfieldConfig] = await Promise.all([
    loadAdsbConfig(),
    loadAirfieldConfig(),
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

      case "overlay-enable":
        await execAsync("sudo raspi-config nonint enable_overlayfs");
        return NextResponse.json({ ok: true, message: "オーバーレイFSを有効にしました。再起動後に反映されます。" });

      case "overlay-disable":
        await execAsync("sudo raspi-config nonint disable_overlayfs");
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
