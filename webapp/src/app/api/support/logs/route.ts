import { NextResponse } from "next/server";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

const SERVICES = ["feeldscope-webapp", "ogn-mqtt", "adsb-poller", "igc-simulator", "mosquitto"];

async function fetchServiceLog(service: string): Promise<string> {
  try {
    const { stdout } = await execAsync(
      `journalctl -u ${service} -n 300 --no-pager --output short-iso 2>&1`,
      { timeout: 10000 }
    );
    return stdout || "(no output)";
  } catch (e: unknown) {
    return `Error fetching log: ${e instanceof Error ? e.message : String(e)}`;
  }
}

async function fetchSystemErrors(): Promise<string> {
  try {
    const { stdout } = await execAsync(
      `journalctl -n 100 --no-pager --output short-iso -p err..crit 2>&1`,
      { timeout: 10000 }
    );
    return stdout || "(no errors)";
  } catch (e: unknown) {
    return `Error fetching system errors: ${e instanceof Error ? e.message : String(e)}`;
  }
}

async function fetchSystemInfo(): Promise<string> {
  const cmds: [string, string][] = [
    ["uname -a", "Kernel"],
    ["uptime", "Uptime"],
    ["df -h /", "Disk usage"],
    ["free -m", "Memory"],
    ["vcgencmd measure_temp 2>/dev/null || echo n/a", "CPU temp"],
  ];
  const lines: string[] = [];
  for (const [cmd, label] of cmds) {
    try {
      const { stdout } = await execAsync(cmd, { timeout: 5000 });
      lines.push(`[${label}]\n${stdout.trim()}`);
    } catch {
      lines.push(`[${label}]\nn/a`);
    }
  }
  return lines.join("\n\n");
}

export async function GET() {
  const [serviceResults, systemErrors, systemInfo] = await Promise.all([
    Promise.all(SERVICES.map(async (svc) => [svc, await fetchServiceLog(svc)] as [string, string])),
    fetchSystemErrors(),
    fetchSystemInfo(),
  ]);

  const services: Record<string, string> = {};
  for (const [svc, log] of serviceResults) {
    services[svc] = log;
  }

  return NextResponse.json({
    services,
    system_errors: systemErrors,
    system_info: systemInfo,
  });
}
