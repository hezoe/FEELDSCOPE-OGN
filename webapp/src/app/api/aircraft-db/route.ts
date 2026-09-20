import { NextResponse } from "next/server";
import { readFile, unlink, writeFile } from "fs/promises";
import { run } from "@/lib/run";
import type { AircraftDatabase, AircraftRecord, AircraftTypeCode } from "@/lib/types";
import { findKeyByAddress, hexAddress } from "@/lib/aircraft-id";

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


// ── オンライン取得（OGN DDB / FlarmNet から JA 登録機を取り込む） ──

/** OGN DDB。JSON。device_id は接頭辞なしの6桁16進 */
const DDB_URL = "http://ddb.glidernet.org/download/?j=1";
/** FlarmNet 公式(LXNAV形式)。全バイト +1 の難読化がかかっている */
const FLARMNET_URL = "https://www.flarmnet.org/files/lxnav.fln";
/** 日本の登録記号: JA + 数字1桁 + 英数3桁（JA0000 / JA0000 など） */
const JA_RE = /^JA[0-9][0-9A-Z]{3}$/;
/** DDB の device_type から機体IDの接頭辞へ。新規に作るときだけ使う */
const DEVICE_TYPE_PREFIX: Record<string, string> = { I: "ICA", F: "FLR", O: "OGN" };
const NET_TIMEOUT_MS = 90_000;

/** ネット側から拾えた項目。空文字は「その源には無い」を意味する */
interface NetRecord {
  registration: string;
  glider_type: string;
  competition_id: string;
  pilot: string;
  prefix: string;
}

/**
 * URL の中身を取ってくる。
 *
 * Node 本体の fetch は使わない。ddb.glidernet.org は AAAA を持つ一方、
 * 滝川の端末には IPv6 の経路が無く、undici が IPv6 を先に試して
 * 毎回 ETIMEDOUT で落ちる（Happy Eyeballs は既定で有効だが効かなかった。
 * 2026-09-20 実機確認）。curl は IPv4 へ落ちるので確実に取れる。
 * 中身が数MBかつ FlarmNet はバイナリなので、パイプではなく一時ファイルを介す。
 */
async function fetchBuffer(url: string): Promise<Buffer> {
  const tmp = `/tmp/feeldscope-acdb-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  try {
    await run("curl", [
      "-sfL", "--max-time", String(Math.floor(NET_TIMEOUT_MS / 1000)),
      "-A", "FEELDSCOPE-OGN/1.0", "-o", tmp, url,
    ], { timeout: NET_TIMEOUT_MS + 10_000 });
    return await readFile(tmp);
  } catch (e) {
    throw new Error(`${url} の取得に失敗しました: ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    await unlink(tmp).catch(() => { /* 消せなくても実害は無い */ });
  }
}

function unescapeXml(v: string): string {
  return v
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_m, d) => String.fromCharCode(parseInt(d, 10)))
    .replace(/&amp;/g, "&");   // & は最後（二重復元を避ける）
}

/** FlarmNet の .fln を平文 XML に戻して、アドレス -> 項目 に開く */
function parseFlarmNet(buf: Buffer): Map<string, NetRecord> {
  const plain = Buffer.from(buf.map((b) => (b - 1) & 0xff)).toString("latin1");
  const out = new Map<string, NetRecord>();
  const recRe = /<FLARMDATA FlarmID="([^"]+)">([\s\S]*?)<\/FLARMDATA>/g;
  const tag = (body: string, t: string) => {
    const m = new RegExp("<" + t + ">([\\s\\S]*?)</" + t + ">").exec(body);
    return m ? unescapeXml(m[1]).trim() : "";
  };
  let m: RegExpExecArray | null;
  while ((m = recRe.exec(plain)) !== null) {
    const hex = hexAddress(m[1]);
    if (!hex) continue;
    const body = m[2];
    out.set(hex, {
      registration: tag(body, "REG").toUpperCase(),
      glider_type: tag(body, "TYPE"),
      competition_id: tag(body, "COMPID"),
      pilot: tag(body, "NAME"),
      prefix: "",
    });
  }
  return out;
}

interface DdbDevice {
  device_id?: string; device_type?: string; aircraft_model?: string;
  registration?: string; cn?: string; identified?: string;
}

interface OnlineFetch {
  records: Map<string, NetRecord>;
  ddbTotal: number; ddbJa: number; flarmnetTotal: number; flarmnetJa: number;
  optedOut: number; dupSkipped: number;
}

/**
 * 両サービスを引いて、JA 登録機だけを アドレス -> 項目 にまとめる。
 * DDB を主とする。FlarmNet に自己登録している日本機は極端に少ない一方
 * （2026-09 時点で全15,000件中9件）、DDB には20件超あるため。
 * FlarmNet は DDB に無い項目（操縦者名）と、DDB が空の項目を埋めるのに使う。
 */
async function fetchOnlineRecords(): Promise<OnlineFetch> {
  const [ddbBuf, flnBuf] = await Promise.all([fetchBuffer(DDB_URL), fetchBuffer(FLARMNET_URL)]);

  const ddbAll: DdbDevice[] = JSON.parse(ddbBuf.toString("utf-8")).devices || [];
  const flarmnet = parseFlarmNet(flnBuf);

  const records = new Map<string, NetRecord>();
  let ddbJa = 0, optedOut = 0;
  for (const d of ddbAll) {
    const reg = (d.registration || "").toUpperCase();
    if (!JA_RE.test(reg)) continue;
    ddbJa += 1;
    // identified='N' は本人が識別の公開を拒否している。取り込まない
    if ((d.identified || "Y").toUpperCase() === "N") { optedOut += 1; continue; }
    const hex = hexAddress(d.device_id);
    if (!hex) continue;
    records.set(hex, {
      registration: reg,
      glider_type: (d.aircraft_model || "").trim(),
      competition_id: (d.cn || "").trim(),
      pilot: "",
      prefix: DEVICE_TYPE_PREFIX[(d.device_type || "").toUpperCase()] || "FLR",
    });
  }

  // DDB に載っている登録記号は、そのアドレスが正。
  // FlarmNet には桁の入れ替わった登録があり（2026-09 実測: JA0000 が
  // DDB=DB0730 / FlarmNet=DB7030 の2つで載っている。受信機が実際に聞くのは
  // DB0730 のほう）、そのまま取り込むと同じ登録記号の行が二重にできる。
  const ddbRegs = new Set(Array.from(records.values()).map((r) => r.registration));

  let flarmnetJa = 0, dupSkipped = 0;
  for (const [hex, f] of flarmnet) {
    if (!JA_RE.test(f.registration)) continue;
    flarmnetJa += 1;
    const cur = records.get(hex);
    if (!cur) {
      if (ddbRegs.has(f.registration)) { dupSkipped += 1; continue; }
      records.set(hex, { ...f, prefix: "FLR" });
      continue;
    }
    // DDB に無い項目だけ FlarmNet で埋める
    if (!cur.pilot && f.pilot) cur.pilot = f.pilot;
    if (!cur.glider_type && f.glider_type) cur.glider_type = f.glider_type;
    if (!cur.competition_id && f.competition_id) cur.competition_id = f.competition_id;
  }

  return {
    records, ddbTotal: ddbAll.length, ddbJa,
    flarmnetTotal: flarmnet.size, flarmnetJa, optedOut, dupSkipped,
  };
}

interface MergeSummary {
  added: string[];
  updated: { device_id: string; changes: string[] }[];
  unchanged: number;
  optedOut: number;
  /** FlarmNet 側に、DDB と同じ登録記号が別アドレスで載っていて弾いた件数 */
  dupSkipped: number;
  sources: { ddb: number; ddbJa: number; flarmnet: number; flarmnetJa: number };
}

/**
 * 取得した内容を既存のDBへ合流させる。
 * - ネット側に値がある項目は、手で入れた値でも上書きする
 * - ネット側に値が無い項目は既存の値をそのまま残す
 * - 機体種別 aircraft_type はどちらの源にも無いので一切触らない
 *   （曳航機の判定に使っており、手で設定した値を壊すと運用に響く）
 * 突合は接頭辞を外した6桁のアドレスで行う。DDB の device_type と
 * 受信機が実際に使う接頭辞は2割ほど食い違うため。
 */
function mergeOnline(db: AircraftDatabase, net: Map<string, NetRecord>): MergeSummary {
  const added: string[] = [];
  const updated: { device_id: string; changes: string[] }[] = [];
  let unchanged = 0;

  for (const [hex, n] of net) {
    const proposed = n.prefix + hex;
    const key = findKeyByAddress(db, proposed);
    if (!key) {
      db[proposed] = {
        device_id: proposed,
        glider_type: n.glider_type,
        registration: n.registration,
        competition_id: n.competition_id,
        pilot: n.pilot,
        aircraft_type: "glider" as AircraftTypeCode,
      };
      added.push(proposed);
      continue;
    }
    const rec = db[key];
    const changes: string[] = [];
    const apply = (field: "registration" | "glider_type" | "competition_id" | "pilot", val: string) => {
      if (!val) return;                      // ネット側に無い項目は触らない
      if ((rec[field] || "") === val) return;
      changes.push(`${field}: ${rec[field] || "(空)"} -> ${val}`);
      rec[field] = val;
    };
    apply("registration", n.registration);
    apply("glider_type", n.glider_type);
    apply("competition_id", n.competition_id);
    apply("pilot", n.pilot);
    if (changes.length > 0) updated.push({ device_id: key, changes });
    else unchanged += 1;
  }

  return {
    added, updated, unchanged, optedOut: 0, dupSkipped: 0,
    sources: { ddb: 0, ddbJa: 0, flarmnet: 0, flarmnetJa: 0 },
  };
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

// POST - オンライン取得、または未知の device_id の一括自動登録
export async function POST(req: Request) {
  try {
    const body = await req.json() as { action?: string; device_ids?: string[] };

    if (body.action === "fetch-online") {
      const net = await fetchOnlineRecords();
      const db = await readDb();
      const summary = mergeOnline(db, net.records);
      summary.optedOut = net.optedOut;
      summary.dupSkipped = net.dupSkipped;
      summary.sources = {
        ddb: net.ddbTotal, ddbJa: net.ddbJa,
        flarmnet: net.flarmnetTotal, flarmnetJa: net.flarmnetJa,
      };
      if (summary.added.length > 0 || summary.updated.length > 0) await writeDb(db);
      return NextResponse.json(summary);
    }

    const { device_ids } = body;
    if (!Array.isArray(device_ids)) return NextResponse.json({ error: "device_ids array required" }, { status: 400 });
    const db = await readDb();
    const added: string[] = [];
    for (const id of device_ids) {
      // 同じアドレスが別の接頭辞で既にあるなら同じ機体。行を増やさない
      if (!findKeyByAddress(db, id)) {
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
