import { NextResponse } from "next/server";
import { appendFile, mkdir, readdir, stat, unlink } from "fs/promises";
import { join } from "path";

const DIR = process.env.FEELDSCOPE_ANALYTICS_DIR || "/home/pi/FEELDSCOPE/analytics";
const RETENTION_DAYS = Number(process.env.FEELDSCOPE_ANALYTICS_RETENTION_DAYS || 30);
const MAX_EVENTS_PER_REQUEST = 5000;

interface PointerSample {
  t: number;
  type: "move" | "click" | "scroll";
  x: number;
  y: number;
  vw: number;
  vh: number;
  tab: string;
  sel?: string;
}

// YYYY-MM-DD in JST (UTC+9), independent of the host timezone.
function jstDateStr(): string {
  const jst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return jst.toISOString().slice(0, 10);
}

function fileFor(date: string): string {
  return join(DIR, `pointer-${date}.jsonl`);
}

// Best-effort deletion of files older than the retention window.
async function pruneOld(): Promise<void> {
  try {
    const cutoff = new Date(Date.now() + 9 * 60 * 60 * 1000);
    cutoff.setDate(cutoff.getDate() - RETENTION_DAYS);
    const cutoffStr = cutoff.toISOString().slice(0, 10);
    const files = await readdir(DIR);
    for (const f of files) {
      const m = f.match(/^pointer-(\d{4}-\d{2}-\d{2})\.jsonl$/);
      if (m && m[1] < cutoffStr) {
        await unlink(join(DIR, f)).catch(() => {});
      }
    }
  } catch {
    // ignore prune failures
  }
}

function isValidSample(s: unknown): s is PointerSample {
  if (typeof s !== "object" || s === null) return false;
  const o = s as Record<string, unknown>;
  return (
    typeof o.t === "number" &&
    (o.type === "move" || o.type === "click" || o.type === "scroll") &&
    typeof o.x === "number" &&
    typeof o.y === "number" &&
    typeof o.vw === "number" &&
    typeof o.vh === "number" &&
    typeof o.tab === "string"
  );
}

// POST - append a batch of pointer samples as JSONL. Accepts both fetch (JSON)
// and navigator.sendBeacon (text/plain Blob) payloads via req.text().
export async function POST(req: Request) {
  try {
    const raw = await req.text();
    if (!raw) return NextResponse.json({ error: "empty body" }, { status: 400 });

    let body: { session?: string; events?: unknown };
    try {
      body = JSON.parse(raw);
    } catch {
      return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
    }

    const { session, events } = body;
    if (!Array.isArray(events)) {
      return NextResponse.json({ error: "events array required" }, { status: 400 });
    }
    if (events.length > MAX_EVENTS_PER_REQUEST) {
      return NextResponse.json({ error: "too many events" }, { status: 400 });
    }

    const sessionId = typeof session === "string" ? session.slice(0, 32) : "";
    const valid = events.filter(isValidSample);
    if (valid.length === 0) return NextResponse.json({ ok: true, written: 0 });

    await mkdir(DIR, { recursive: true });
    const lines =
      valid.map((s) => JSON.stringify({ ...s, s: sessionId })).join("\n") + "\n";
    await appendFile(fileFor(jstDateStr()), lines, "utf-8");

    // Opportunistic, non-blocking cleanup.
    void pruneOld();

    return NextResponse.json({ ok: true, written: valid.length });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

// GET - list recorded data files (for later export / verification).
export async function GET() {
  try {
    let files: string[];
    try {
      files = await readdir(DIR);
    } catch (e: unknown) {
      if (e instanceof Error && "code" in e && (e as NodeJS.ErrnoException).code === "ENOENT") {
        return NextResponse.json({ files: [] });
      }
      throw e;
    }

    const out: { name: string; size: number; date: string }[] = [];
    for (const f of files) {
      const m = f.match(/^pointer-(\d{4}-\d{2}-\d{2})\.jsonl$/);
      if (!m) continue;
      const info = await stat(join(DIR, f));
      out.push({ name: f, size: info.size, date: m[1] });
    }
    out.sort((a, b) => b.date.localeCompare(a.date));
    return NextResponse.json({ files: out });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
