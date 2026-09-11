import { NextResponse } from "next/server";
import { getAuthContext, isAuthorizedToMutate } from "@/lib/auth";
import { isSafeServiceName, runQuiet, runShell } from "@/lib/run";

const SERVICES = ["feeldscope-webapp", "ogn-mqtt", "adsb-poller", "igc-simulator", "mosquitto"];

async function fetchServiceLog(service: string): Promise<string> {
  if (!isSafeServiceName(service)) return "(invalid service name)";
  const out = await runQuiet(
    "journalctl",
    ["-u", service, "-n", "300", "--no-pager", "--output", "short-iso"],
    { timeout: 10000 },
  );
  return out || "(no output)";
}

async function fetchSystemErrors(): Promise<string> {
  const out = await runQuiet(
    "journalctl",
    ["-n", "100", "--no-pager", "--output", "short-iso", "-p", "err..crit"],
    { timeout: 10000 },
  );
  return out || "(no errors)";
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
      const { stdout } = await runShell(cmd, { timeout: 5000 });
      lines.push(`[${label}]\n${stdout.trim()}`);
    } catch {
      lines.push(`[${label}]\nn/a`);
    }
  }
  return lines.join("\n\n");
}

export async function GET(request: Request) {
  // システムログ全文は機微。閲覧は管理者/オペレーター(リモートサポート中)のみ許可。
  const ctx = await getAuthContext(request);
  if (!isAuthorizedToMutate(ctx)) {
    return NextResponse.json(
      { error: "ログ閲覧には管理者ログインが必要です。", needsAuth: true },
      { status: 401 }
    );
  }
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
