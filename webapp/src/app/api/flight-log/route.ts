import { NextResponse } from "next/server";

interface FlightLogEntry {
  registration: string;
  deviceId: string;
  takeoffTime: string;
  landingTime: string | null;
  releaseAlt: number | null;
  releaseDist: number | null;
}

// In-memory flight log store
let flightLog: FlightLogEntry[] = [];
let lastResetDate: string = "";

/** Reset at 05:00 JST daily */
function checkDailyReset(): void {
  const now = new Date();
  // JST = UTC+9
  const jstHours = (now.getUTCHours() + 9) % 24;
  const jstDate = new Date(now.getTime() + 9 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  // Reset if it's past 05:00 JST and we haven't reset for today
  if (jstHours >= 5 && lastResetDate !== jstDate) {
    flightLog = [];
    lastResetDate = jstDate;
  }
}

// GET /api/flight-log — return current flight log
export async function GET() {
  checkDailyReset();
  return NextResponse.json({ entries: flightLog });
}

// POST /api/flight-log — update flight log
export async function POST(request: Request) {
  checkDailyReset();
  const body = await request.json();
  const { action } = body;

  switch (action) {
    case "set": {
      // Replace entire log (used for sync from client)
      const entries: FlightLogEntry[] = body.entries || [];
      flightLog = entries;
      return NextResponse.json({ ok: true, count: flightLog.length });
    }

    case "append": {
      // Add a single entry
      const entry: FlightLogEntry = body.entry;
      if (!entry) return NextResponse.json({ error: "entry required" }, { status: 400 });
      flightLog.push(entry);
      return NextResponse.json({ ok: true, index: flightLog.length - 1 });
    }

    case "update": {
      // Update entry at index
      const idx: number = body.index;
      const entry: Partial<FlightLogEntry> = body.entry;
      if (idx < 0 || idx >= flightLog.length) {
        return NextResponse.json({ error: "invalid index" }, { status: 400 });
      }
      flightLog[idx] = { ...flightLog[idx], ...entry };
      return NextResponse.json({ ok: true });
    }

    case "delete": {
      const idx: number = body.index;
      if (idx < 0 || idx >= flightLog.length) {
        return NextResponse.json({ error: "invalid index" }, { status: 400 });
      }
      flightLog.splice(idx, 1);
      return NextResponse.json({ ok: true, count: flightLog.length });
    }

    case "reset": {
      flightLog = [];
      return NextResponse.json({ ok: true });
    }

    default:
      return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
  }
}
