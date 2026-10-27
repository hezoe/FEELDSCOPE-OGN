import { NextResponse } from "next/server";
import { readFile, rename, unlink, writeFile } from "fs/promises";
import { run } from "@/lib/run";
import type { AircraftDatabase, AircraftRecord, AircraftTypeCode } from "@/lib/types";
import { AIRCRAFT_TYPE_OPTIONS } from "@/lib/types";
import { findKeyByAddress, hexAddress } from "@/lib/aircraft-id";
import { clientIpFromRequest, getAuthContext, isAuthorizedToMutate } from "@/lib/auth";
import { persistFiles } from "@/lib/persist";

const DB_PATH = process.env.FEELDSCOPE_AIRCRAFT_DB || "/home/pi/FEELDSCOPE/aircraft-db.json";

async function readDb(): Promise<AircraftDatabase> {
  let raw: string;
  try {
    raw = await readFile(DB_PATH, "utf-8");
  } catch (e: unknown) {
    if (e instanceof Error && "code" in e && (e as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw e;
  }
  try {
    return JSON.parse(raw);
  } catch (e: unknown) {
    // 破損時は機能全体を止めない。まず末尾に余分な文字が付いた等の軽微な破損を救出、
    // 無理なら破損版を退避して空DBで継続する(次の writeDb で正規化される)。
    const bak = `${DB_PATH}.corrupt-${new Date().toISOString().replace(/[:.]/g, "-")}`;
    const msg = e instanceof Error ? e.message : String(e);
    const m = e instanceof Error ? e.message.match(/position (\d+)/) : null;
    if (m) {
      try {
        const salvaged = JSON.parse(raw.slice(0, Number(m[1]))) as AircraftDatabase;
        await writeFile(bak, raw, "utf-8").catch(() => { /* 退避失敗は無視 */ });
        console.warn(`[aircraft-db] ${DB_PATH} 末尾の破損を救出しました(退避: ${bak}): ${msg}`);
        return salvaged;
      } catch { /* 救出不可 → 下の空DB継続へ */ }
    }
    await writeFile(bak, raw, "utf-8").catch(() => { /* 退避失敗は無視 */ });
    console.error(`[aircraft-db] ${DB_PATH} が壊れていたため退避(${bak})し、空DBで継続します: ${msg}`);
    return {};
  }
}

async function writeDb(db: AircraftDatabase): Promise<void> {
  // 原子的置換: 一時ファイルへ全量書き込み→rename。書込み途中の再起動でも本体が壊れない。
  const tmp = `${DB_PATH}.tmp-${process.pid}-${Date.now()}`;
  try {
    await writeFile(tmp, JSON.stringify(db, null, 2), "utf-8");
    await rename(tmp, DB_PATH);
  } catch (e) {
    await unlink(tmp).catch(() => { /* 後始末失敗は無視 */ });
    throw e;
  }
  // 固定化(OverlayFS)中は下の SD にも書き写す(電源断・再起動で登録が消えないように)
  await persistFiles(DB_PATH);
}


// ── オンライン取得（OGN DDB / FlarmNet から JA 登録機を取り込む） ──

/** OGN DDB。JSON。device_id は接頭辞なしの6桁16進 */
const DDB_URL = "http://ddb.glidernet.org/download/?j=1";
/** FlarmNet 公式(LXNAV形式)。全バイト +1 の難読化がかかっている */
const FLARMNET_URL = "https://www.flarmnet.org/files/lxnav.fln";
/** 日本の登録記号: JA + 数字1桁 + 英数3桁（JA1234 / JA12AB など） */
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
  // FlarmNet には桁の入れ替わった登録があり（2026-09 実測: ある機体が
  // DDB と FlarmNet で桁の入れ替わった2つのアドレスで載っている。受信機が実際に聞くのは
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
  const fetchedAt = new Date().toISOString();
  const added: string[] = [];
  const updated: { device_id: string; changes: string[] }[] = [];
  let unchanged = 0;

  for (const [hex, n] of net) {
    const proposed = n.prefix + hex;
    // 取り込んだ値そのものを控える。あとで手で直されたかを見分けるため
    const snapshot = {
      registration: n.registration || undefined,
      glider_type: n.glider_type || undefined,
      competition_id: n.competition_id || undefined,
      pilot: n.pilot || undefined,
      fetched_at: fetchedAt,
    };
    const key = findKeyByAddress(db, proposed);
    if (!key) {
      db[proposed] = {
        device_id: proposed,
        glider_type: n.glider_type,
        registration: n.registration,
        competition_id: n.competition_id,
        pilot: n.pilot,
        aircraft_type: "glider" as AircraftTypeCode,
        online: snapshot,
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
    // ネット側が値を持たない項目は控えにも残さない（比較対象にしない）
    rec.online = { ...rec.online, ...snapshot };
    if (changes.length > 0) updated.push({ device_id: key, changes });
    else unchanged += 1;
  }

  return {
    added, updated, unchanged, optedOut: 0, dupSkipped: 0,
    sources: { ddb: 0, ddbJa: 0, flarmnet: 0, flarmnetJa: 0 },
  };
}

// ── 書き換えの入口の検査(セキュリティ点検 R-008) ──
// 機体 DB の値は地図のラベルなどに出る。以前は誰でも書き換えられたので、
// 編集・削除・オンライン取得は管理者ログインかリモートサポートの操作者だけにする。
// 地図が未知の機体を空の行で登録する自動登録は、閲覧中の誰のブラウザからも呼ばれるので開けたまま。

/** JSON 以外の本文(別サイトのフォームの text/plain など)は受け付けない */
function notJson(req: Request): NextResponse | null {
  if (/^application\/json\b/i.test(req.headers.get("content-type") || "")) return null;
  return NextResponse.json({ error: "Content-Type は application/json にしてください" }, { status: 415 });
}

async function denyUnlessAuthorized(req: Request): Promise<NextResponse | null> {
  const bad = notJson(req);
  if (bad) return bad;
  if (isAuthorizedToMutate(await getAuthContext(req))) return null;
  return NextResponse.json(
    { error: "機体情報の変更には管理者ログインが必要です。", needsAuth: true },
    { status: 401 },
  );
}

/** device_id として受け付ける形(FLR/ICA/OGN などの接頭辞+アドレス) */
const DEVICE_ID_RE = /^[A-Za-z0-9_-]{1,40}$/;
const TEXT_FIELDS = ["glider_type", "registration", "competition_id", "pilot"] as const;
const AIRCRAFT_TYPES = new Set<string>(AIRCRAFT_TYPE_OPTIONS.map((o) => o.value));

class RecordInputError extends Error {}

/** 画面から届いた1行を検査して、決まった項目だけに詰め直す(online の控えはサーバー側の値を使う) */
function sanitizeRecord(raw: unknown, prev: AircraftRecord | undefined): AircraftRecord {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new RecordInputError("機体情報がありません");
  const r = raw as Record<string, unknown>;
  const device_id = typeof r.device_id === "string" ? r.device_id.trim() : "";
  if (!DEVICE_ID_RE.test(device_id)) {
    throw new RecordInputError("デバイスIDは英数字・ハイフン・アンダースコア40文字以内で入力してください");
  }
  const out = { device_id } as AircraftRecord;
  for (const f of TEXT_FIELDS) {
    const v = r[f] === undefined || r[f] === null ? "" : r[f];
    if (typeof v !== "string") throw new RecordInputError(`${f} は文字で入力してください`);
    if (v.length > 64) throw new RecordInputError(`${f} は64文字以内で入力してください`);
    if (/[\x00-\x1f\x7f]/.test(v)) throw new RecordInputError(`${f} に改行などの制御文字は使えません`);
    out[f] = v;
  }
  const t = r.aircraft_type ?? "glider";
  if (typeof t !== "string" || !AIRCRAFT_TYPES.has(t)) throw new RecordInputError("機体種別が正しくありません");
  out.aircraft_type = t as AircraftTypeCode;
  // オンライン取得の控えは画面から編集しない(消してしまうと「手で直した」印が出せなくなる)
  if (prev?.online) out.online = prev.online;
  return out;
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
  const denied = await denyUnlessAuthorized(req);
  if (denied) return denied;
  try {
    const body = await req.json().catch(() => null);
    const db = await readDb();
    const device_id = (body as { device_id?: unknown } | null)?.device_id;
    const prev = typeof device_id === "string" ? db[device_id.trim()] : undefined;
    const incoming = sanitizeRecord(body, prev);
    // 誰がいつ何を変えたかを記録に残す
    const ip = clientIpFromRequest(req) || "不明";
    const changed = (["registration", "glider_type", "competition_id", "pilot", "aircraft_type"] as const)
      .filter((f) => (prev?.[f] ?? "") !== (incoming[f] ?? ""))
      .map((f) => `${f}: ${prev?.[f] || "(空)"} -> ${incoming[f] || "(空)"}`);
    console.log(prev
      ? `[aircraft-db] edit from ${ip}: ${incoming.device_id}${changed.length ? " / " + changed.join(", ") : " / 変更なし"}`
      : `[aircraft-db] add from ${ip}: ${incoming.device_id} ${incoming.registration || "(登録番号なし)"}`);
    db[incoming.device_id] = incoming;
    await writeDb(db);
    return NextResponse.json(db[incoming.device_id]);
  } catch (err) {
    if (err instanceof RecordInputError) return NextResponse.json({ error: err.message }, { status: 400 });
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

// DELETE - remove a record
export async function DELETE(req: Request) {
  const denied = await denyUnlessAuthorized(req);
  if (denied) return denied;
  try {
    const { device_id } = (await req.json().catch(() => ({}))) as { device_id?: unknown };
    if (typeof device_id !== "string" || !DEVICE_ID_RE.test(device_id)) {
      return NextResponse.json({ error: "device_id required" }, { status: 400 });
    }
    const db = await readDb();
    const gone = db[device_id];
    console.log(`[aircraft-db] ★delete from ${clientIpFromRequest(req) || "不明"}: `
      + `${device_id} ${gone?.registration || "(登録番号なし)"}`);
    delete db[device_id];
    await writeDb(db);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

// POST - オンライン取得、または未知の device_id の一括自動登録
export async function POST(req: Request) {
  const bad = notJson(req);
  if (bad) return bad;
  try {
    const body = (await req.json().catch(() => ({}))) as { action?: string; device_ids?: unknown };

    if (body.action === "fetch-online") {
      const denied = await denyUnlessAuthorized(req);
      if (denied) return denied;
      const net = await fetchOnlineRecords();
      const db = await readDb();
      const summary = mergeOnline(db, net.records);
      summary.optedOut = net.optedOut;
      summary.dupSkipped = net.dupSkipped;
      summary.sources = {
        ddb: net.ddbTotal, ddbJa: net.ddbJa,
        flarmnet: net.flarmnetTotal, flarmnetJa: net.flarmnetJa,
      };
      // 追加も更新も無くても、控え(online)と取得日時は毎回書き直す。
      // ここを「変更があったときだけ」にすると、2回目以降の取得で控えが
      // 作られないままになる（実機で踏んだ）。ボタンを押したときだけ動く
      // 手動操作なので、毎回書いても SD への負担は問題にならない。
      await writeDb(db);
      console.log(`[aircraft-db] fetch-online from ${clientIpFromRequest(req) || "不明"}: `
        + `新規${summary.added.length} 更新${summary.updated.length} 変更なし${summary.unchanged}`);
      return NextResponse.json(summary);
    }

    const { device_ids } = body;
    if (!Array.isArray(device_ids)) return NextResponse.json({ error: "device_ids array required" }, { status: 400 });
    const db = await readDb();
    const added: string[] = [];
    // 自動登録は認証なしで呼ばれるので、形の合う ID だけを1回100件まで受け付ける
    const ids = device_ids.filter((id): id is string => typeof id === "string" && DEVICE_ID_RE.test(id)).slice(0, 100);
    for (const id of ids) {
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
    if (added.length > 0) {
      await writeDb(db);
      console.log(`[aircraft-db] auto-register: ${added.join(", ")}`);
    }
    return NextResponse.json({ added });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
