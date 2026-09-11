import { NextResponse } from "next/server";
import {
  getFlightLog,
  getPhases,
  resetFlightLog,
  setFlightLog,
  startFlightTracker,
  type FlightLogEntry,
} from "@/lib/flight-tracker";

// 検知は instrumentation.ts から起動されるが、そこが走らない構成でも
// 動くよう、このルートが読み込まれた時点でも起動しておく（二重起動はしない）。
startFlightTracker();

// GET /api/flight-log — 現在の飛行記録と、機体ごとの状態
export async function GET() {
  return NextResponse.json({ entries: getFlightLog(), phases: getPhases() });
}

// POST /api/flight-log — ブラウザからの手動編集
export async function POST(request: Request) {
  const body = await request.json();
  const { action } = body;

  switch (action) {
    case "set": {
      const entries: FlightLogEntry[] = body.entries || [];
      setFlightLog(entries);
      return NextResponse.json({ ok: true, count: getFlightLog().length });
    }

    case "reset": {
      resetFlightLog();
      return NextResponse.json({ ok: true });
    }

    default:
      return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
  }
}
