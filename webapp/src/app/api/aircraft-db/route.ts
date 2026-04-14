import { NextResponse } from "next/server";
import { readFile, writeFile } from "fs/promises";
import type { AircraftDatabase, AircraftRecord, AircraftTypeCode } from "@/lib/types";

const DB_PATH = process.env.FEELDSCOPE_AIRCRAFT_DB || "/home/pi/FEELDSCOPE/aircraft-db.json";

async function readDb(): Promise<AircraftDatabase> {
  try {
    const raw = await readFile(DB_PATH, "utf-8");
    return JSON.parse(raw);
  } catch (e: unknown) {
    if (e instanceof Error && "code" in e && (e as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw e;
  }
}

async function writeDb(db: AircraftDatabase): Promise<void> {
  await writeFile(DB_PATH, JSON.stringify(db, null, 2), "utf-8");
}

// GET - return full database
export async function GET() {
  try {
    const db = await readDb();
    return NextResponse.json(db);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

// PUT - upsert a single record
export async function PUT(req: Request) {
  try {
    const body = await req.json();
    const { device_id } = body as AircraftRecord;
    if (!device_id) return NextResponse.json({ error: "device_id required" }, { status: 400 });
    const db = await readDb();
    db[device_id] = body as AircraftRecord;
    await writeDb(db);
    return NextResponse.json(db[device_id]);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

// DELETE - remove a record
export async function DELETE(req: Request) {
  try {
    const { device_id } = await req.json();
    if (!device_id) return NextResponse.json({ error: "device_id required" }, { status: 400 });
    const db = await readDb();
    delete db[device_id];
    await writeDb(db);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

// POST - batch auto-register unknown device_ids
export async function POST(req: Request) {
  try {
    const { device_ids } = await req.json() as { device_ids: string[] };
    if (!Array.isArray(device_ids)) return NextResponse.json({ error: "device_ids array required" }, { status: 400 });
    const db = await readDb();
    const added: string[] = [];
    for (const id of device_ids) {
      if (!db[id]) {
        db[id] = {
          device_id: id,
          glider_type: "",
          registration: "",
          competition_id: "",
          pilot: "",
          aircraft_type: "glider" as AircraftTypeCode,
        };
        added.push(id);
      }
    }
    if (added.length > 0) await writeDb(db);
    return NextResponse.json({ added });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
